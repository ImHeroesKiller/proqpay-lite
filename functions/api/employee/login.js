import {
  countRecentFailures, createEmployeeSession, employeeHandlePreflight, employeeJson,
  findEmployeeForLogin, isActiveEmployee, portalMutationAllowed, recordLoginAttempt,
  verifyEmployeeSecret,
} from '../_employee-auth.js';
import { d1First, d1Run, hasD1 } from '../_d1.js';
import { enforceRateLimit, publicError } from '../_security.js';

const METHODS = 'POST, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return employeeHandlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return employeeJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!portalMutationAllowed(request, env)) {
    return employeeJson({ error: 'Origin not allowed' }, 403, request, env, METHODS);
  }

  const limited = await enforceRateLimit(
    request,
    env,
    { id: request.headers.get('CF-Connecting-IP') || 'anonymous-employee-login' },
    'employee-login',
    METHODS,
  );
  if (limited) return limited;

  if (!hasD1(env)) {
    return employeeJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);
  }

  let body;
  try { body = await request.json(); } catch {
    return employeeJson({ error: 'Invalid JSON' }, 400, request, env, METHODS);
  }

  const empId = String(body.emp_id || body.empId || '').trim().slice(0, 80);
  const password = String(body.password || '').slice(0, 256);
  if (!empId || !password) {
    return employeeJson({ error: 'Employee ID dan password wajib diisi' }, 422, request, env, METHODS);
  }

  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
  const orgId = String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
  const fail = async (reason) => {
    await recordLoginAttempt(env.DB, {
      employeeIdInput: empId, employeeId: reason.employeeId, ip, success: false, reason: reason.code,
    });
    return employeeJson({ error: 'Employee ID atau password tidak valid' }, 401, request, env, METHODS);
  };

  try {
    if (await countRecentFailures(env.DB, ip, empId) >= 5) {
      return employeeJson({ error: 'Terlalu banyak percobaan. Coba kembali 10 menit lagi.' }, 429, request, env, METHODS);
    }

    const employee = await findEmployeeForLogin(env.DB, empId, orgId);
    const credentials = employee
      ? await d1First(env.DB, 'SELECT * FROM employee_credentials WHERE employee_id=? LIMIT 1', [employee.id])
      : null;
    const valid = await verifyEmployeeSecret(password, credentials);
    if (!employee || !credentials || !valid || !isActiveEmployee(employee)) {
      if (credentials) {
        await d1Run(env.DB, `UPDATE employee_credentials SET
          failed_login_attempts=failed_login_attempts+1,
          locked_until=CASE WHEN failed_login_attempts+1 >= 5 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes') ELSE locked_until END,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE employee_id=?`, [employee.id]);
      }
      return fail({ code: 'INVALID', employeeId: employee?.id });
    }

    if (credentials.locked_until && new Date(credentials.locked_until).getTime() > Date.now()) {
      await recordLoginAttempt(env.DB, {
        employeeIdInput: empId, employeeId: employee.id, ip, success: false, reason: 'LOCKED',
      });
      return employeeJson({ error: 'Akun terkunci sementara. Coba kembali 15 menit lagi.' }, 429, request, env, METHODS);
    }

    const session = await createEmployeeSession(env.DB, employee.id, env);
    await d1Run(env.DB, `UPDATE employee_credentials SET last_login_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      failed_login_attempts=0, locked_until=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE employee_id=?`, [employee.id]);
    await recordLoginAttempt(env.DB, {
      employeeIdInput: empId, employeeId: employee.id, ip, success: true, reason: 'OK',
    });

    return employeeJson({
      ok: true,
      emp_id: employee.employee_code || employee.id,
      emp_code: employee.employee_code || employee.id,
      emp_name: employee.name,
      client_id: employee.client_id,
      org_id: employee.org_id,
      mustChangePassword: Boolean(credentials.must_change_password),
      token: session.token,
    }, 200, request, env, METHODS, { 'Set-Cookie': session.cookie });
  } catch (error) {
    return employeeJson({ error: 'Employee login failed', ...publicError(error, crypto.randomUUID()) }, 500, request, env, METHODS);
  }
}