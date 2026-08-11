import { neon } from '@neondatabase/serverless';
import {
  databaseUrl, generateTemporaryPassword, passwordRecord,
} from './_account-auth.js';
import { handlePreflight, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';
const RECOVERY_HASH = '9e85e4255a51ec64e95a37aed24b4964746ae1898ab5e9df74c1a6762f37d9a5';
const TARGET_EMAIL = 'superadmin@msg-os.com';
const encoder = new TextEncoder();

async function tokenHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value || '')));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left, right) {
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) return secureJson({ error: 'Same-origin request required' }, 403, request, env, METHODS);

  const body = await request.json().catch(() => ({}));
  const suppliedHash = await tokenHash(body.recoveryToken);
  if (!safeEqual(suppliedHash, RECOVERY_HASH) || String(body.email || '').toLowerCase() !== TARGET_EMAIL) {
    return secureJson({ error: 'Recovery authorization rejected' }, 403, request, env, METHODS);
  }

  const url = databaseUrl(env);
  if (!url) return secureJson({ error: 'Database unavailable' }, 503, request, env, METHODS);
  const sql = neon(url);
  const users = await sql`SELECT id, email, role FROM app_users
    WHERE LOWER(email)=${TARGET_EMAIL} AND role='SUPER_ADMIN' AND status='ACTIVE' LIMIT 1`;
  if (!users.length) return secureJson({ error: 'Active Super Admin not found' }, 404, request, env, METHODS);

  const password = generateTemporaryPassword();
  const record = await passwordRecord(password);
  const user = users[0];
  await sql.transaction((tx) => [
    tx`UPDATE app_users SET password_hash=${record.hash}, password_salt=${record.salt},
      password_iterations=${record.iterations}, must_change_password=TRUE,
      failed_login_attempts=0, locked_until=NULL, updated_at=NOW() WHERE id=${user.id}`,
    tx`DELETE FROM app_sessions WHERE user_id=${user.id}`,
    tx`INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
      VALUES (${`AUD-${crypto.randomUUID()}`}, 'ORG-OTSINDO', ${TARGET_EMAIL}, 'SUPER_ADMIN',
        'EMERGENCY_PASSWORD_RECOVERY', 'One-time recovery; all sessions revoked', 'app_user', ${user.id})`,
  ]);
  return secureJson({ ok: true, email: TARGET_EMAIL, temporaryPassword: password }, 200, request, env, METHODS);
}
