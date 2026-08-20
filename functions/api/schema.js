import { authorize, handlePreflight, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ['SUPER_ADMIN'], mutating: true, methods: METHODS });
  if (authorization.response) return authorization.response;
  return secureJson({
    error: 'Runtime schema mutation retired',
    code: 'MIGRATIONS_ONLY',
    action: 'Jalankan migration D1 melalui Wrangler pada deployment pipeline.',
  }, 410, request, env, METHODS);
}
