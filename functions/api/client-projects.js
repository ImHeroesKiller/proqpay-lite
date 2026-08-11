import { neon } from '@neondatabase/serverless';
import {
  authorize, clientIdsFor, projectIdsFor, enforceRateLimit, handlePreflight, publicError, secureJson,
} from './_security.js';
import { validateDirectoryAction } from './client-projects-validation.js';

const METHODS = 'GET, POST, OPTIONS';

function databaseUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

function codeBase(name, fallback) {
  const words = String(name || '').toUpperCase().replace(/\b(PT|CV|TBK|PERSERO)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const compact = words.length > 3 ? words.map((word) => word[0]).join('') : words.join('-');
  return (compact || fallback).slice(0, 26);
}

async function uniqueClientCode(sql, orgId, name, excludeId) {
  const base = codeBase(name, 'CLIENT');
  for (let index = 0; index < 100; index += 1) {
    const code = index ? `${base.slice(0, 26)}-${index + 1}` : base;
    const rows = await sql`SELECT id FROM clients WHERE org_id=${orgId} AND code=${code} AND (${excludeId || null}::text IS NULL OR id<>${excludeId || null}) LIMIT 1`;
    if (!rows.length) return code;
  }
  return `CLIENT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function uniqueProjectCode(sql, orgId, name, excludeId) {
  const base = codeBase(name, 'PROJECT');
  for (let index = 0; index < 100; index += 1) {
    const code = index ? `${base.slice(0, 26)}-${index + 1}` : base;
    const rows = await sql`SELECT id FROM projects WHERE org_id=${orgId} AND code=${code} AND (${excludeId || null}::text IS NULL OR id<>${excludeId || null}) LIMIT 1`;
    if (!rows.length) return code;
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
  const url = databaseUrl(env);
  if (!url) return respond({ error: 'Service unavailable', requestId }, 503);
  const sql = neon(url);
  const actor = authorization.actor;
  const organizationId = String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
  try {
    await sql.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS website TEXT`);
    await sql.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry TEXT`);
    await sql.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name TEXT`);
    await sql.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_email TEXT`);
    await sql.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_phone TEXT`);
    await sql.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_url TEXT`);
    await sql.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE'`);
    await sql.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT`);
    await sql.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_type TEXT`);
    if (request.method === 'GET') {
      const scope = clientIdsFor(actor, env);
      const scopeCsv = (scope || []).join(',');
      const projectScope = projectIdsFor(actor);
      const projectScopeCsv = (projectScope || []).join(',');
      const [clients, projects] = await Promise.all([
        sql`SELECT c.id, c.code, c.name, c.website, c.industry, c.contact_name, c.contact_email, c.contact_phone,
          c.logo_url, c.status, c.created_at,
          COUNT(DISTINCT e.id)::int AS employee_count,
          COUNT(DISTINCT p.id)::int AS project_count,
          (SELECT COUNT(*)::int FROM user_client_scopes ucs WHERE ucs.client_id=c.id) AS assigned_user_count
          FROM clients c
          LEFT JOIN employees e ON e.client_id=c.id
          LEFT JOIN projects p ON p.client_id=c.id
          WHERE c.org_id=${organizationId}
            AND (${actor.role !== 'CLIENT_USER'} OR c.id = ANY(string_to_array(${scopeCsv}, ',')))
          GROUP BY c.id ORDER BY c.name`,
        sql`SELECT p.*, c.name AS client_name,
          (SELECT COUNT(*)::int FROM user_project_scopes ups WHERE ups.project_id=p.id) AS assigned_user_count
          FROM projects p JOIN clients c ON c.id=p.client_id
          WHERE p.org_id=${organizationId}
            AND (${actor.role !== 'CLIENT_USER'} OR p.client_id = ANY(string_to_array(${scopeCsv}, ',')))
            AND (${actor.role !== 'CLIENT_USER' || !projectScope?.length} OR p.id = ANY(string_to_array(${projectScopeCsv}, ',')))
          ORDER BY p.created_at DESC LIMIT 500`,
      ]);
      return respond({ ok: true, clients, projects, role: actor.role });
    }
    const raw = await request.json().catch(() => null);
    const validation = validateDirectoryAction(raw);
    if (!validation.ok) return respond({ error: validation.errors.join('; ') }, 422);
    const body = validation.value;
    if (body.action === 'CREATE_CLIENT') {
      const id = body.id || `CLI-${crypto.randomUUID()}`;
      const code = body.code || await uniqueClientCode(sql, organizationId, body.name, null);
      const logoUrl = await discoverPwaIcon(body.website);
      const rows = await sql`INSERT INTO clients (id, org_id, code, name, website, industry, contact_name, contact_email, contact_phone, logo_url, status)
        VALUES (${id}, ${organizationId}, ${code}, ${body.name}, ${body.website}, ${body.industry}, ${body.contactName}, ${body.contactEmail}, ${body.contactPhone}, ${logoUrl}, ${body.status || 'ACTIVE'}) RETURNING *`;
      return respond({ ok: true, client: rows[0] }, 201);
    }
    if (body.action === 'UPDATE_CLIENT') {
      const code = body.code || await uniqueClientCode(sql, organizationId, body.name, body.id);
      const current = await sql`SELECT website, logo_url FROM clients WHERE id=${body.id} AND org_id=${organizationId} LIMIT 1`;
      const logoUrl = body.website && body.website !== current[0]?.website ? await discoverPwaIcon(body.website) : current[0]?.logo_url;
      const rows = await sql`UPDATE clients SET code=${code}, name=${body.name}, website=${body.website}, industry=${body.industry},
        contact_name=${body.contactName}, contact_email=${body.contactEmail}, contact_phone=${body.contactPhone}, logo_url=${logoUrl}, status=${body.status || 'ACTIVE'}
        WHERE id=${body.id} AND org_id=${organizationId} RETURNING *`;
      if (!rows.length) return respond({ error: 'Client not found' }, 404);
      return respond({ ok: true, client: rows[0] });
    }
    const client = await sql`SELECT id FROM clients WHERE id=${body.clientId} AND org_id=${organizationId} LIMIT 1`;
    if (!client.length) return respond({ error: 'Client not found' }, 404);
    if (body.action === 'UPDATE_PROJECT') {
      const code = body.code || await uniqueProjectCode(sql, organizationId, body.name, body.id);
      const rows = await sql`UPDATE projects SET client_id=${body.clientId}, code=${code}, name=${body.name},
        description=${body.description}, service_type=${body.serviceType}, status=${body.status || 'ACTIVE'}, start_date=${body.startDate || null}, end_date=${body.endDate || null}, updated_at=NOW()
        WHERE id=${body.id} AND org_id=${organizationId} RETURNING *`;
      if (!rows.length) return respond({ error: 'Project not found' }, 404);
      return respond({ ok: true, project: rows[0] });
    }
    const id = body.id || `PRJ-${crypto.randomUUID()}`;
    const code = body.code || await uniqueProjectCode(sql, organizationId, body.name, null);
    const rows = await sql`INSERT INTO projects
      (id, org_id, client_id, code, name, description, service_type, status, start_date, end_date, created_by)
      VALUES (${id}, ${organizationId}, ${body.clientId}, ${code}, ${body.name}, ${body.description}, ${body.serviceType}, ${body.status || 'ACTIVE'},
        ${body.startDate || null}, ${body.endDate || null}, ${actor.email})
      RETURNING *`;
    return respond({ ok: true, project: rows[0] }, 201);
  } catch (error) {
    if (String(error?.message || '').includes('duplicate key')) return respond({ error: 'Code sudah digunakan' }, 409);
    return respond(publicError(error, requestId), 500);
  }
}
