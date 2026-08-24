import { authenticateEmployee, employeeHandlePreflight, employeeJson } from '../_employee-auth.js';
import { hasD1 } from '../_d1.js';

const METHODS = 'GET, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return employeeHandlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return employeeJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!hasD1(env)) {
    return employeeJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);
  }
  const actor = await authenticateEmployee(request, env);
  if (!actor) return employeeJson({ error: 'Sesi tidak valid atau kedaluwarsa.' }, 401, request, env, METHODS);
  return employeeJson({
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