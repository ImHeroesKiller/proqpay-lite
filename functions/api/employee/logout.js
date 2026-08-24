import { clearEmployeeSessionCookie, portalMutationAllowed, revokeEmployeeSession } from '../_employee-auth.js';
import { hasD1 } from '../_d1.js';
import { handlePreflight, secureJson } from '../_security.js';

const METHODS = 'POST, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!portalMutationAllowed(request, env)) {
    return secureJson({ error: 'Origin not allowed' }, 403, request, env, METHODS);
  }
  if (hasD1(env)) await revokeEmployeeSession(request, env.DB);
  return secureJson({ ok: true }, 200, request, env, METHODS, { 'Set-Cookie': clearEmployeeSessionCookie() });
}
