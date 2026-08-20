import { d1All, d1First, hasD1 } from './_d1.js';
import {
  authorize, clientIdsFor, projectIdsFor, enforceRateLimit, handlePreflight, publicError, secureJson,
} from './_security.js';
import { validateDirectoryAction } from './client-projects-validation.js';

const METHODS = 'GET, POST, OPTIONS';

function codeBase(name, fallback) {
  const words = String(name || '').toUpperCase().replace(/\b(PT|CV|TBK|PERSERO)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const compact = words.length > 3 ? words.map((word) => word[0]).join('') : words.join('-');
  return (compact || fallback).slice(0, 26);
}

async function uniqueClientCode(database, orgId, name, excludeId) {
  const base = codeBase(name, 'CLIENT');
  for (let index = 0; index < 100; index += 1) {
    const code = index ? `${base.slice(0, 26)}-${index + 1}` : base;
    const row = await d1First(database, 'SELECT id FROM clients WHERE org_id=? AND code=? AND (? IS NULL OR id<>?) LIMIT 1', [orgId, code, excludeId || null, excludeId || null]);
    if (!row) return code;
  }
  return `CLIENT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function uniqueProjectCode(database, orgId, name, excludeId) {
  const base = codeBase(name, 'PROJECT');
  for (let index = 0; index < 100; index += 1) {
    const code = index ? `${base.slice(0, 26)}-${index + 1}` : base;
    const row = await d1First(database, 'SELECT id FROM projects WHERE org_id=? AND code=? AND (? IS NULL OR id<>?) LIMIT 1', [orgId, code, excludeId || null, excludeId || null]);
    if (!row) return code;
  }
  return `PROJECT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function safeWebsite(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const privateIpv4 = /^(?:0\.|127\.|10\.|192\.168\.|169\.254\.)/.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
    const privateIpv6 = host === '[::1]' || host === '::1' || /^\[?(?:fc|fd|fe8|fe9|fea|feb)/i.test(host);
    if (url.protocol !== 'https:' || host === 'localhost' || host.endsWith('.local') || privateIpv4 || privateIpv6) return null;
    return url;
  } catch { return null; }
}

function linkAttribute(tag, name) {
  return tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '';
}

async function discoverPwaIcon(website) {
  const url = safeWebsite(website);
  if (!url) return null;
  try {
    const response = await fetch(url.toString(), { redirect: 'follow', signal: AbortSignal.timeout(5000), headers: { Accept: 'text/html' } });
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 1_000_000) return null;
    const html = (await response.text()).slice(0, 1_000_000);
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
    const manifestTag = links.find((tag) => /rel\s*=\s*["'][^"']*manifest/i.test(tag));
    if (manifestTag) {
      const href = linkAttribute(manifestTag, 'href');
      if (href) {
        const manifestUrl = new URL(href, response.url || url);
        if (safeWebsite(manifestUrl.toString())) {
          const manifestResponse = await fetch(manifestUrl.toString(), { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/manifest+json, application/json' } });
          if (manifestResponse.ok) {
            const manifest = await manifestResponse.json();
            const icons = Array.isArray(manifest.icons) ? manifest.icons.filter((icon) => icon?.src) : [];
            const icon = icons.sort((a, b) => Number.parseInt(b.sizes || '0', 10) - Number.parseInt(a.sizes || '0', 10))[0];
            if (icon) return new URL(icon.src, manifestUrl).toString();
          }
        }
      }
    }
    const iconTag = links.find((tag) => /rel\s*=\s*["'][^"']*(apple-touch-icon|icon)/i.test(tag));
    const href = iconTag ? linkAttribute(iconTag, 'href') : '';
    return href ? new URL(href, response.url || url).toString() : new URL('/favicon.ico', response.url || url).toString();
  } catch { return null; }
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }
  const authorization = await authorize(request, env, {
    roles: request.method === 'POST' ? ['SUPER_ADMIN', 'PAYROLL_PROCESSOR'] : undefined,
    mutating: request.method === 'POST', methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'client-project-directory', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 unavailable', requestId }, 503);
  const database = env.DB;
  const actor = authorization.actor;
  const organizationId = String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
  try {
    if (request.method === 'GET') {
      const scope = clientIdsFor(actor, env);
      const projectScope = projectIdsFor(actor);
      const clientRestricted = actor.role === 'CLIENT_USER';
      if (clientRestricted && !scope?.length) return respond({ ok: true, clients: [], projects: [], role: actor.role });
      const clientFilter = clientRestricted ? ` AND c.id IN (${scope.map(() => '?').join(',')})` : '';
      const projectClientFilter = clientRestricted ? ` AND p.client_id IN (${scope.map(() => '?').join(',')})` : '';
      const projectFilter = clientRestricted && projectScope?.length ? ` AND p.id IN (${projectScope.map(() => '?').join(',')})` : '';
      const [clients, projects] = await Promise.all([
        d1All(database, `SELECT c.id, c.code, c.name, c.website, c.industry, c.contact_name, c.contact_email, c.contact_phone,
          c.logo_url, c.status, c.created_at,
          COUNT(DISTINCT e.id) AS employee_count,
          COUNT(DISTINCT p.id) AS project_count,
          (SELECT COUNT(*) FROM user_client_scopes ucs WHERE ucs.client_id=c.id) AS assigned_user_count
          FROM clients c
          LEFT JOIN employees e ON e.client_id=c.id
          LEFT JOIN projects p ON p.client_id=c.id
          WHERE c.org_id=?${clientFilter}
          GROUP BY c.id ORDER BY c.name`, [organizationId, ...(clientRestricted ? scope : [])]),
        d1All(database, `SELECT p.*, c.name AS client_name,
          (SELECT COUNT(*) FROM user_project_scopes ups WHERE ups.project_id=p.id) AS assigned_user_count
          FROM projects p JOIN clients c ON c.id=p.client_id
          WHERE p.org_id=?${projectClientFilter}${projectFilter}
          ORDER BY p.created_at DESC LIMIT 500`, [organizationId, ...(clientRestricted ? scope : []), ...(clientRestricted && projectScope?.length ? projectScope : [])]),
      ]);
      return respond({ ok: true, clients, projects, role: actor.role });
    }
    const raw = await request.json().catch(() => null);
    const validation = validateDirectoryAction(raw);
    if (!validation.ok) return respond({ error: validation.errors.join('; ') }, 422);
    const body = validation.value;
    if (body.action === 'CREATE_CLIENT') {
      const id = body.id || `CLI-${crypto.randomUUID()}`;
      const code = body.code || await uniqueClientCode(database, organizationId, body.name, null);
      const logoUrl = await discoverPwaIcon(body.website);
      const client = await d1First(database, `INSERT INTO clients (id, org_id, code, name, website, industry, contact_name, contact_email, contact_phone, logo_url, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [id, organizationId, code, body.name, body.website, body.industry, body.contactName, body.contactEmail, body.contactPhone, logoUrl, body.status || 'ACTIVE']);
      return respond({ ok: true, client }, 201);
    }
    if (body.action === 'UPDATE_CLIENT') {
      const code = body.code || await uniqueClientCode(database, organizationId, body.name, body.id);
      const current = await d1First(database, 'SELECT website, logo_url FROM clients WHERE id=? AND org_id=? LIMIT 1', [body.id, organizationId]);
      const logoUrl = body.website && body.website !== current?.website ? await discoverPwaIcon(body.website) : current?.logo_url;
      const client = await d1First(database, `UPDATE clients SET code=?, name=?, website=?, industry=?, contact_name=?,
        contact_email=?, contact_phone=?, logo_url=?, status=? WHERE id=? AND org_id=? RETURNING *`,
        [code, body.name, body.website, body.industry, body.contactName, body.contactEmail, body.contactPhone, logoUrl, body.status || 'ACTIVE', body.id, organizationId]);
      if (!client) return respond({ error: 'Client not found' }, 404);
      return respond({ ok: true, client });
    }
    const client = await d1First(database, 'SELECT id FROM clients WHERE id=? AND org_id=? LIMIT 1', [body.clientId, organizationId]);
    if (!client) return respond({ error: 'Client not found' }, 404);
    if (body.action === 'UPDATE_PROJECT') {
      const code = body.code || await uniqueProjectCode(database, organizationId, body.name, body.id);
      const project = await d1First(database, `UPDATE projects SET client_id=?, code=?, name=?, description=?, service_type=?,
        status=?, start_date=?, end_date=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND org_id=? RETURNING *`,
        [body.clientId, code, body.name, body.description, body.serviceType, body.status || 'ACTIVE', body.startDate || null, body.endDate || null, body.id, organizationId]);
      if (!project) return respond({ error: 'Project not found' }, 404);
      return respond({ ok: true, project });
    }
    const id = body.id || `PRJ-${crypto.randomUUID()}`;
    const code = body.code || await uniqueProjectCode(database, organizationId, body.name, null);
    const project = await d1First(database, `INSERT INTO projects
      (id, org_id, client_id, code, name, description, service_type, status, start_date, end_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [id, organizationId, body.clientId, code, body.name, body.description, body.serviceType, body.status || 'ACTIVE', body.startDate || null, body.endDate || null, actor.email]);
    return respond({ ok: true, project }, 201);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE constraint failed')) return respond({ error: 'Code sudah digunakan' }, 409);
    return respond(publicError(error, requestId), 500);
  }
}
