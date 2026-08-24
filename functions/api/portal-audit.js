import { d1All, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'GET, OPTIONS';
const OPS = new Set(['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER']);

function orgId(env, actor) {
  return String(env.DEFAULT_ORG_ID || actor?.orgId || 'ORG-OTSINDO');
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
  const kind = String(new URL(request.url).searchParams.get('kind') || 'all').toLowerCase();

  try {
    const logins = kind === 'ewa'
      ? []
      : await d1All(
        env.DB,
        `SELECT a.id, a.employee_id_input, a.employee_id, a.ip, a.success, a.reason, a.created_at,
            e.name AS employee_name, e.employee_code
          FROM portal_login_attempts a
          LEFT JOIN employees e ON e.id=a.employee_id
          WHERE a.employee_id IS NULL OR e.org_id=?
          ORDER BY a.created_at DESC
          LIMIT 200`,
        [organizationId],
      );
    const events = kind === 'logins'
      ? []
      : await d1All(
        env.DB,
        `SELECT id, timestamp, username, role, action, detail, entity, entity_id
          FROM audit_logs
          WHERE org_id=?
            AND (
              entity IN ('ewa_request', 'employee_credentials', 'employee')
              OR action LIKE 'EWA_%'
              OR action LIKE 'EMPLOYEE_PORTAL_%'
              OR action IN ('EMPLOYEE_PASSWORD_CHANGED')
            )
          ORDER BY timestamp DESC
          LIMIT 200`,
        [organizationId],
      );
    return respond({
      ok: true,
      logins,
      events,
      failedLogins: logins.filter((row) => !Number(row.success)).length,
    });
  } catch (error) {
    return respond({ error: 'Portal audit failed', ...publicError(error, crypto.randomUUID()) }, 500);
  }
}
