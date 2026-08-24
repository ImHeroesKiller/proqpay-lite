import {
  authenticateEmployee, passwordRecord, portalMutationAllowed, validatePassword, verifyPassword,
} from '../_employee-auth.js';
import { d1Batch, d1First, hasD1 } from '../_d1.js';
import { handlePreflight, publicError, secureJson } from '../_security.js';

const METHODS = 'POST, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!portalMutationAllowed(request, env)) {
    return secureJson({ error: 'Origin not allowed' }, 403, request, env, METHODS);
  }
  if (!hasD1(env)) {
    return secureJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);
  }

  const actor = await authenticateEmployee(request, env);
  if (!actor) return secureJson({ error: 'Sesi tidak valid atau kedaluwarsa.' }, 401, request, env, METHODS);

  let body;
  try { body = await request.json(); } catch {
    return secureJson({ error: 'Invalid JSON' }, 400, request, env, METHODS);
  }

  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  const problem = validatePassword(newPassword);
  if (problem) return secureJson({ error: problem }, 422, request, env, METHODS);

  try {
    const current = await d1First(env.DB, 'SELECT * FROM employee_credentials WHERE employee_id=? LIMIT 1', [actor.id]);
    if (!current || !(await verifyPassword(currentPassword, current))) {
      return secureJson({ error: 'Password saat ini tidak valid' }, 401, request, env, METHODS);
    }
    const record = await passwordRecord(newPassword);
    const orgId = String(env.DEFAULT_ORG_ID || actor.orgId || 'ORG-OTSINDO');
    await d1Batch(env.DB, [
      {
        statement: `UPDATE employee_credentials SET password_hash=?, password_salt=?, password_iterations=?,
          must_change_password=0, password_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          failed_login_attempts=0, locked_until=NULL,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE employee_id=?`,
        bindings: [record.hash, record.salt, record.iterations, actor.id],
      },
      { statement: 'DELETE FROM employee_portal_sessions WHERE employee_id=?', bindings: [actor.id] },
      {
        statement: `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
          VALUES (?, ?, ?, 'EMPLOYEE', 'EMPLOYEE_PASSWORD_CHANGED', ?, 'employee', ?)`,
        bindings: [
          `AUD-${crypto.randomUUID()}`, orgId, actor.employeeCode,
          'Password portal diubah oleh karyawan; seluruh sesi portal dicabut', actor.id,
        ],
      },
    ]);
    return secureJson({ ok: true, sessionRevoked: true }, 200, request, env, METHODS);
  } catch (error) {
    return secureJson({ error: 'Password change failed', ...publicError(error, crypto.randomUUID()) }, 500, request, env, METHODS);
  }
}
