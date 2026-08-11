import { neon } from '@neondatabase/serverless';
import {
  ACCOUNT_ROLES, databaseUrl, ensureAccountSchema, generateTemporaryPassword,
  passwordRecord, validatePassword, verifyPassword,
} from './_account-auth.js';
import {
  ROLES, authorize, enforceRateLimit, handlePreflight, publicError, secureJson,
} from './_security.js';

const METHODS = 'GET, POST, OPTIONS';
const ORG_ID = 'ORG-OTSINDO';

function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

function validClientIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(Boolean))].slice(0, 200);
}

async function replaceClientScopes(sql, userId, clientIds) {
  await sql.transaction((tx) => [
    tx`DELETE FROM user_client_scopes WHERE user_id=${userId}`,
    ...clientIds.map((clientId) => tx`
      INSERT INTO user_client_scopes (user_id, client_id)
      SELECT ${userId}, id FROM clients WHERE id=${clientId} AND org_id=${ORG_ID}
      ON CONFLICT DO NOTHING`),
  ]);
}

async function activeSuperAdminCount(sql) {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM app_users WHERE role='SUPER_ADMIN' AND status='ACTIVE'`;
  return Number(rows[0]?.count || 0);
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);

  const authorization = await authorize(request, env, {
    roles: ROLES, mutating: request.method === 'POST', methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'accounts', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const url = databaseUrl(env);
  if (!url) return respond({ error: 'Database unavailable' }, 503);
  const sql = neon(url);
  const actor = authorization.actor;
  const requestId = crypto.randomUUID();

  try {
    await ensureAccountSchema(sql);
    if (request.method === 'GET') {
      if (actor.role !== 'SUPER_ADMIN') return respond({ error: 'Insufficient role' }, 403);
      const [users, clients] = await Promise.all([
        sql`SELECT u.id, u.name, u.email, u.role, u.status, u.must_change_password,
          u.payment_approver, u.last_login_at, u.created_at,
          COALESCE(array_agg(ucs.client_id) FILTER (WHERE ucs.client_id IS NOT NULL), ARRAY[]::text[]) AS client_ids
          FROM app_users u LEFT JOIN user_client_scopes ucs ON ucs.user_id=u.id
          WHERE u.org_id=${ORG_ID} GROUP BY u.id ORDER BY u.created_at ASC`,
        sql`SELECT id, name FROM clients WHERE org_id=${ORG_ID} ORDER BY name ASC`,
      ]);
      return respond({
        ok: true,
        users: users.map((user) => ({
          id: user.id, name: user.name, email: user.email, role: user.role,
          status: user.status, mustChangePassword: user.must_change_password,
          paymentApprover: user.payment_approver, clientIds: user.client_ids || [],
          lastLoginAt: user.last_login_at, createdAt: user.created_at,
        })),
        clients,
        roles: ACCOUNT_ROLES,
      });
    }

    let body;
    try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
    if (body.action === 'CHANGE_PASSWORD') {
      const newPassword = String(body.newPassword || '');
      const problem = validatePassword(newPassword);
      if (problem) return respond({ error: problem }, 422);
      const rows = await sql`SELECT * FROM app_users WHERE id=${actor.id} LIMIT 1`;
      if (!rows.length || !(await verifyPassword(String(body.currentPassword || ''), rows[0]))) {
        return respond({ error: 'Password saat ini tidak valid' }, 401);
      }
      const record = await passwordRecord(newPassword);
      await sql.transaction((tx) => [
        tx`UPDATE app_users SET password_hash=${record.hash}, password_salt=${record.salt},
          password_iterations=${record.iterations}, must_change_password=FALSE,
          password_changed_at=NOW(), updated_at=NOW() WHERE id=${actor.id}`,
        tx`DELETE FROM app_sessions WHERE user_id=${actor.id}`,
        tx`INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
          VALUES (${`AUD-${crypto.randomUUID()}`}, ${ORG_ID}, ${actor.email}, ${actor.role}, 'ACCOUNT_PASSWORD_CHANGED',
            'Password diubah oleh pemilik akun; seluruh sesi dicabut', 'app_user', ${actor.id})`,
      ]);
      return respond({ ok: true, sessionRevoked: true });
    }

    if (actor.role !== 'SUPER_ADMIN') return respond({ error: 'Insufficient role' }, 403);

    if (body.action === 'CREATE') {
      const name = String(body.name || '').trim().slice(0, 120);
      const email = normalizedEmail(body.email);
      const role = String(body.role || 'CLIENT_USER').toUpperCase();
      if (!name || !email || !ACCOUNT_ROLES.includes(role)) return respond({ error: 'Nama, email, atau role tidak valid' }, 422);
      const clientIds = role === 'CLIENT_USER' ? validClientIds(body.clientIds) : [];
      if (role === 'CLIENT_USER' && !clientIds.length) return respond({ error: 'CLIENT_USER wajib memiliki minimal satu client scope' }, 422);
      const password = generateTemporaryPassword();
      const record = await passwordRecord(password);
      const id = `USR-${crypto.randomUUID()}`;
      await sql`INSERT INTO app_users
        (id, org_id, name, email, role, status, password_hash, password_salt, password_iterations,
          must_change_password, payment_approver, created_by)
        VALUES (${id}, ${ORG_ID}, ${name}, ${email}, ${role}, 'ACTIVE', ${record.hash}, ${record.salt},
          ${record.iterations}, TRUE, ${role === 'PAYROLL_CONTROLLER' && Boolean(body.paymentApprover)}, ${actor.email})`;
      await replaceClientScopes(sql, id, clientIds);
      await sql`INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
        VALUES (${`AUD-${crypto.randomUUID()}`}, ${ORG_ID}, ${actor.email}, ${actor.role}, 'ACCOUNT_CREATED',
          ${`${email} · ${role}`}, 'app_user', ${id})`;
      return respond({ ok: true, user: { id, name, email, role, status: 'ACTIVE', clientIds }, temporaryPassword: password }, 201);
    }

    if (body.action === 'UPDATE') {
      const userId = String(body.userId || '');
      const existing = (await sql`SELECT * FROM app_users WHERE id=${userId} AND org_id=${ORG_ID} LIMIT 1`)[0];
      if (!existing) return respond({ error: 'User tidak ditemukan' }, 404);
      const role = String(body.role || existing.role).toUpperCase();
      const status = String(body.status || existing.status).toUpperCase();
      if (!ACCOUNT_ROLES.includes(role) || !['ACTIVE', 'SUSPENDED', 'INACTIVE'].includes(status)) return respond({ error: 'Role atau status tidak valid' }, 422);
      if (existing.role === 'SUPER_ADMIN' && existing.status === 'ACTIVE' && (role !== 'SUPER_ADMIN' || status !== 'ACTIVE') && await activeSuperAdminCount(sql) <= 1) {
        return respond({ error: 'Super Admin aktif terakhir tidak boleh dinonaktifkan atau diturunkan' }, 409);
      }
      const name = String(body.name || existing.name).trim().slice(0, 120);
      const clientIds = role === 'CLIENT_USER' ? validClientIds(body.clientIds) : [];
      if (role === 'CLIENT_USER' && !clientIds.length) return respond({ error: 'CLIENT_USER wajib memiliki minimal satu client scope' }, 422);
      await sql`UPDATE app_users SET name=${name}, role=${role}, status=${status},
        payment_approver=${role === 'PAYROLL_CONTROLLER' && Boolean(body.paymentApprover)}, updated_at=NOW()
        WHERE id=${userId}`;
      await replaceClientScopes(sql, userId, clientIds);
      if (status !== 'ACTIVE' || role !== existing.role) await sql`DELETE FROM app_sessions WHERE user_id=${userId}`;
      await sql`INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
        VALUES (${`AUD-${crypto.randomUUID()}`}, ${ORG_ID}, ${actor.email}, ${actor.role}, 'ACCOUNT_UPDATED',
          ${`${existing.email} · ${role} · ${status}`}, 'app_user', ${userId})`;
      return respond({ ok: true });
    }

    if (body.action === 'RESET_PASSWORD') {
      const userId = String(body.userId || '');
      const user = (await sql`SELECT id FROM app_users WHERE id=${userId} AND org_id=${ORG_ID} LIMIT 1`)[0];
      if (!user) return respond({ error: 'User tidak ditemukan' }, 404);
      const password = generateTemporaryPassword();
      const record = await passwordRecord(password);
      await sql.transaction((tx) => [
        tx`UPDATE app_users SET password_hash=${record.hash}, password_salt=${record.salt},
          password_iterations=${record.iterations}, must_change_password=TRUE,
          failed_login_attempts=0, locked_until=NULL, updated_at=NOW() WHERE id=${userId}`,
        tx`DELETE FROM app_sessions WHERE user_id=${userId}`,
        tx`INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
          VALUES (${`AUD-${crypto.randomUUID()}`}, ${ORG_ID}, ${actor.email}, ${actor.role}, 'ACCOUNT_PASSWORD_RESET',
            'Password sementara dibuat; seluruh sesi user dicabut', 'app_user', ${userId})`,
      ]);
      return respond({ ok: true, temporaryPassword: password });
    }

    return respond({ error: 'Action tidak dikenal' }, 422);
  } catch (error) {
    if (String(error?.message || '').includes('idx_app_users_email_lower') || String(error?.message || '').includes('app_users_email_key')) {
      return respond({ error: 'Email sudah digunakan' }, 409);
    }
    return respond(publicError(error, requestId), 500);
  }
}
