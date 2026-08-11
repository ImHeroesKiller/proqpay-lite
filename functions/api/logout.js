import { neon } from '@neondatabase/serverless';
import { clearSessionCookie, databaseUrl, revokeSession } from './_account-auth.js';
import { handlePreflight, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return secureJson({ error: 'Same-origin request required' }, 403, request, env, METHODS);
  }
  const url = databaseUrl(env);
  if (url) await revokeSession(request, neon(url));
  return secureJson({ ok: true }, 200, request, env, METHODS, { 'Set-Cookie': clearSessionCookie() });
}
