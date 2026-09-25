import { d1All, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'GET, OPTIONS';
const OPS = new Set(['SUPER_ADMIN']);

function orgId(env, actor) {
  return String(env.DEFAULT_ORG_ID || actor?.orgId || 'ORG-OTSINDO');
}

function pageMeta(offset, limit, total, rows) {
  return {
    offset,
    limit,
    total,
    hasMore: offset + rows.length < total,
    nextOffset: offset + rows.length,
  };
}

async function loadLogins(database, organizationId, { q, success, from, to, offset, limit }) {
  const clauses = ['a.org_id=?'];
  const bindings = [organizationId];
  if (q) {
    clauses.push("(lower(COALESCE(e.name,'')) LIKE ? OR lower(COALESCE(e.employee_code,'')) LIKE ? OR lower(COALESCE(a.employee_id_input,'')) LIKE ? OR lower(COALESCE(a.ip,'')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    bindings.push(like, like, like, like);
  }
  if (success === '1' || success === '0') { clauses.push('a.success=?'); bindings.push(Number(success)); }
  if (from) { clauses.push('a.created_at>=?'); bindings.push(from + 'T00:00:00'); }
  if (to) { clauses.push('a.created_at<?'); bindings.push(to + 'T23:59:59.999'); }
  const where = clauses.join(' AND ');
  const rows = await d1All(
    database,
    `SELECT a.id, a.org_id, a.employee_id_input, a.employee_id, a.ip, a.success, a.reason, a.created_at,
        e.name AS employee_name, e.employee_code
      FROM portal_login_attempts a
      LEFT JOIN employees e ON e.id=a.employee_id
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?`,
    [...bindings, limit, offset],
  );
  const count = await d1First(
    database,
    `SELECT COUNT(*) AS total,
        SUM(CASE WHEN a.success=0 THEN 1 ELSE 0 END) AS failed
      FROM portal_login_attempts a
      LEFT JOIN employees e ON e.id=a.employee_id
      WHERE ${where}`,
    bindings,
  );
  const total = Number(count?.total || 0);
  return {
    rows,
    failed: Number(count?.failed || 0),
    page: pageMeta(offset, limit, total, rows),
  };
}

async function loadEvents(database, organizationId, { q, action, group, from, to, offset, limit }) {
  const clauses = [
    'org_id=?',
    `(
      entity IN ('ewa_request','employee_credentials')
      OR action LIKE 'EWA_%'
      OR action LIKE 'EMPLOYEE_PORTAL_%'
      OR action IN ('EMPLOYEE_PASSWORD_CHANGED','EMPLOYEE_PORTAL_PASSWORDS_ISSUED')
    )`,
  ];
  const bindings = [organizationId];
  if (action) {
    clauses.push('action=?');
    bindings.push(action);
  }
  if (group === 'ewa') clauses.push("action LIKE 'EWA_%'");
  if (group === 'credentials') clauses.push("(action LIKE 'EMPLOYEE_PORTAL_%' OR action IN ('EMPLOYEE_PASSWORD_CHANGED','EMPLOYEE_PORTAL_PASSWORDS_ISSUED'))");
  if (from) { clauses.push('timestamp>=?'); bindings.push(from + 'T00:00:00'); }
  if (to) { clauses.push('timestamp<?'); bindings.push(to + 'T23:59:59.999'); }
  if (q) {
    clauses.push("(lower(COALESCE(username,'')) LIKE ? OR lower(COALESCE(action,'')) LIKE ? OR lower(COALESCE(detail,'')) LIKE ? OR lower(COALESCE(entity_id,'')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    bindings.push(like, like, like, like);
  }
  const where = clauses.join(' AND ');
  const rows = await d1All(
    database,
    `SELECT id, timestamp, username, role, action, detail, entity, entity_id
      FROM audit_logs
      WHERE ${where}
      ORDER BY timestamp DESC, id DESC
      LIMIT ? OFFSET ?`,
    [...bindings, limit, offset],
  );
  const count = await d1First(database, `SELECT COUNT(*) AS total FROM audit_logs WHERE ${where}`, bindings);
  const total = Number(count?.total || 0);
  return { rows, page: pageMeta(offset, limit, total, rows) };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, {
    roles: [...OPS],
    mutating: false,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'portal-audit', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);

  const organizationId = orgId(env, authorization.actor);
  const params = new URL(request.url).searchParams;
  const kindRaw = String(params.get('kind') || 'all').toLowerCase();
  const kind = ['all','logins','events'].includes(kindRaw) ? kindRaw : 'all';
  const q = String(params.get('q') || '').trim().slice(0, 80);
  const action = String(params.get('action') || '').trim().slice(0, 80);
  const success = String(params.get('success') || '').trim();
  const group = String(params.get('group') || '').trim().toLowerCase();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(params.get('from') || '')) ? String(params.get('from')) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(params.get('to') || '')) ? String(params.get('to')) : '';
  const offset = Math.max(0, Number.parseInt(params.get('offset') || '0', 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(params.get('limit') || '50', 10) || 50));

  try {
    const loginResult = kind === 'events'
      ? { rows: [], failed: 0, page: pageMeta(offset, limit, 0, []) }
      : await loadLogins(env.DB, organizationId, { q, success, from, to, offset, limit });
    const eventResult = kind === 'logins'
      ? { rows: [], page: pageMeta(offset, limit, 0, []) }
      : await loadEvents(env.DB, organizationId, { q, action, group, from, to, offset, limit });

    return respond({
      ok: true,
      kind,
      logins: loginResult.rows,
      events: eventResult.rows,
      failedLogins: loginResult.failed,
      page: kind === 'events' ? eventResult.page : loginResult.page,
      pages: { logins: loginResult.page, events: eventResult.page },
      filters: { q, action, success, group, from, to },
    });
  } catch (error) {
    return respond({ error: 'Portal audit failed', ...publicError(error, crypto.randomUUID()) }, 500);
  }
}
