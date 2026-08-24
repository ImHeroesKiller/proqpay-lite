import {
  clearEmployeeSessionCookie, employeeHandlePreflight, employeeJson,
  portalMutationAllowed, revokeEmployeeSession,
} from '../_employee-auth.js';
import { hasD1 } from '../_d1.js';

const METHODS = 'POST, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return employeeHandlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return employeeJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!portalMutationAllowed(request, env)) {
    return employeeJson({ error: 'Origin not allowed' }, 403, request, env, METHODS);
  }
  if (hasD1(env)) await revokeEmployeeSession(request, env.DB);
  return employeeJson({ ok: true }, 200, request, env, METHODS, { 'Set-Cookie': clearEmployeeSessionCookie() });
}