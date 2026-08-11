import { neon } from '@neondatabase/serverless';
import {
  createSession, databaseUrl, ensureAccountSchema, verifyPassword,
} from './_account-auth.js';
import { enforceRateLimit, handlePreflight, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin ? origin === new URL(request.url).origin : request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!sameOrigin(request)) return secureJson({ error: 'Same-origin request required' }, 403, request, env, METHODS);

  const limited = await enforceRateLimit(
    request,
    env,
    { id: request.headers.get('CF-Connecting-IP') || 'anonymous-login' },
    'account-login',
    METHODS
  );
  if (limited) return limited;

  const url = databaseUrl(env);
  if (!url) return secureJson({ error: 'Database unavailable' }, 503, request, env, METHODS);
  let body;
  try { body = await request.json(); } catch { return secureJson({ error: 'Invalid JSON' }, 400, request, env, METHODS); }
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  const password = String(body.password || '').slice(0, 256);
  if (!email || !password) return secureJson({ error: 'Email dan password wajib diisi' }, 422, request, env, METHODS);

  const sql = neon(url);
  await ensureAccountSchema(sql);
  const rows = await sql`SELECT * FROM app_users WHERE LOWER(email)=${email} LIMIT 1`;
  const user = rows[0];
  if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return secureJson({ error: 'Akun terkunci sementara. Coba kembali 15 menit lagi.' }, 429, request, env, METHODS);
  }
  const valid = user ? await verifyPassword(password, user) : false;
  if (!valid || user.status !== 'ACTIVE') {
    if (user) await sql`UPDATE app_users SET
      failed_login_attempts=failed_login_attempts+1,
      locked_until=CASE WHEN failed_login_attempts+1 >= 5 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END,
      updated_at=NOW() WHERE id=${user.id}`;
    return secureJson({ error: 'Email atau password tidak valid' }, 401, request, env, METHODS);
  }

  const session = await createSession(sql, user.id, env);
  await sql`UPDATE app_users SET last_login_at=NOW(), failed_login_attempts=0, locked_until=NULL, updated_at=NOW() WHERE id=${user.id}`;
  return secureJson({
    ok: true,
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
    },
  }, 200, request, env, METHODS, { 'Set-Cookie': session.cookie });
}
