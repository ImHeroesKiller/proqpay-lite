import { d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { EMAIL_FILL_CONFIRMATION, validateEmailFillRequest } from './employee-email-fill-validation.js';

const METHODS = 'POST, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR'], mutating: true, methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'employee-email-fill', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);

  let body;
  try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
  const validated = validateEmailFillRequest(body);
  if (!validated.ok) return respond({ error: validated.errors.join('; ') }, 422);
  const { planId, domain, expectedCount } = validated.value;
  const requestId = crypto.randomUUID();
  try {
    const current = await d1First(env.DB, `SELECT COUNT(*) AS n FROM employees
      WHERE org_id=? AND (email IS NULL OR trim(email)='')`, [env.DEFAULT_ORG_ID || 'ORG-OTSINDO']);
    if (Number(current?.n || 0) !== expectedCount) {
      return respond({ error: 'Data berubah sejak preview dibuat. Buat preview email baru.', expectedCount, currentCount: Number(current?.n || 0) }, 409);
    }
    await d1Batch(env.DB, [
      { statement: `UPDATE employees SET email=lower(replace(replace(trim(id),' ','-'),'@','-') || '@' || ?),
          updated_at=datetime('now') WHERE org_id=? AND (email IS NULL OR trim(email)='')`, bindings: [domain, env.DEFAULT_ORG_ID || 'ORG-OTSINDO'] },
      { statement: `INSERT OR IGNORE INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?,?,?)`, bindings: [`LOG-EMAIL-FILL-${planId}`, env.DEFAULT_ORG_ID || 'ORG-OTSINDO', authorization.actor.email, authorization.actor.role, 'EMPLOYEE_EMAIL_PLACEHOLDERS_FILLED', `${expectedCount} placeholder emails filled with domain ${domain}`, 'Employee', planId] },
    ]);
    return respond({ ok: true, atomic: true, updated: expectedCount, domain, planId, confirmation: EMAIL_FILL_CONFIRMATION });
  } catch (error) {
    return respond({ ok: false, ...publicError(error, requestId) }, 500);
  }
}
