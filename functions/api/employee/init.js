import { authenticateEmployee, employeeHandlePreflight, employeeJson } from '../_employee-auth.js';
import { hasD1 } from '../_d1.js';
import { buildEmployeePortalPayload } from '../_employee-init.js';
import { publicError } from '../_security.js';

const METHODS = 'GET, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return employeeHandlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return employeeJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!hasD1(env)) {
    return employeeJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);
  }
  const actor = await authenticateEmployee(request, env);
  if (!actor) return employeeJson({ error: 'Sesi tidak valid atau kedaluwarsa.' }, 401, request, env, METHODS);
  try {
    const payload = await buildEmployeePortalPayload(env.DB, actor);
    if (!payload) return employeeJson({ error: 'Karyawan tidak ditemukan.' }, 404, request, env, METHODS);
    return employeeJson(payload, 200, request, env, METHODS);
  } catch (error) {
    return employeeJson({ error: 'Gagal memuat portal', ...publicError(error, crypto.randomUUID()) }, 500, request, env, METHODS);
  }
}
