import { authenticateEmployee } from '../_employee-auth.js';
import { hasD1 } from '../_d1.js';
import { handlePreflight, secureJson } from '../_security.js';

const METHODS = 'GET, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!hasD1(env)) {
    return secureJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);
  }
  const actor = await authenticateEmployee(request, env);
  if (!actor) return secureJson({ error: 'Sesi tidak valid atau kedaluwarsa.' }, 401, request, env, METHODS);
  return secureJson({
    ok: true,
    authenticated: true,
    role: 'EMPLOYEE',
    employee: {
      id: actor.id,
      emp_id: actor.employeeCode,
      emp_code: actor.employeeCode,
      name: actor.name,
      email: actor.email,
      client_id: actor.clientId,
      project_id: actor.projectId,
      org_id: actor.orgId,
      mustChangePassword: actor.mustChangePassword,
    },
  }, 200, request, env, METHODS);
}
