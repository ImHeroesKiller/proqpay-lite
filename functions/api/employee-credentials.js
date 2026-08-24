import { passwordRecord } from './_account-auth.js';
import {
  ISSUE_BATCH_SIZE, assignDefaultPasswords, isActiveEmployee,
} from './_employee-auth.js';
import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import {
  authorize, enforceRateLimit, handlePreflight, publicError, secureJson,
} from './_security.js';

const METHODS = 'GET, POST, OPTIONS';
const ISSUERS = new Set(['SUPER_ADMIN', 'PAYROLL_PROCESSOR']);
const ACTIVE_EMPLOYEE_SQL = `(e.status_aktif IS NULL OR trim(e.status_aktif)='' OR (
  lower(e.status_aktif) NOT LIKE '%non%'
  AND lower(e.status_aktif) NOT LIKE '%inaktif%'
  AND lower(e.status_aktif) NOT LIKE '%inactive%'
  AND lower(e.status_aktif) NOT LIKE '%resign%'
  AND lower(e.status_aktif) NOT LIKE '%keluar%'
  AND lower(e.status_aktif) NOT LIKE '%terminate%'
))`;

function orgId(env) {
  return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: [...ISSUERS],
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'employee-credentials', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);

  const database = env.DB;
  const actor = authorization.actor;
  const organizationId = orgId(env);
  const requestId = crypto.randomUUID();

  try {
    if (request.method === 'GET') {
      const summary = await d1First(database, `SELECT
        (SELECT COUNT(*) FROM employees WHERE org_id=?) AS total,
        (SELECT COUNT(*) FROM employee_credentials c JOIN employees e ON e.id=c.employee_id WHERE e.org_id=?) AS issued,
        (SELECT COUNT(*) FROM employees e LEFT JOIN employee_credentials c ON c.employee_id=e.id
          WHERE e.org_id=? AND c.employee_id IS NULL AND ${ACTIVE_EMPLOYEE_SQL}) AS pending`,
      [organizationId, organizationId, organizationId]);
      const total = Number(summary?.total || 0);
      const issued = Number(summary?.issued || 0);
      return respond({
        ok: true,
        scheme: 'PROJECT_JOIN_DATE',
        formula: '{PROJECT_SLUG}{JOIN_YYYYMMDD}',
        total,
        issued,
        pending: Number(summary?.pending || 0),
        batchSize: ISSUE_BATCH_SIZE,
      });
    }

    let body;
    try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
    const action = String(body.action || 'ISSUE').toUpperCase();

    if (action === 'RESET') {
      const employeeId = String(body.employeeId || body.emp_id || '').trim();
      if (!employeeId) return respond({ error: 'employeeId wajib' }, 422);
      const employee = await d1First(database, `SELECT e.id, e.employee_code, e.name, e.status_aktif, e.created_at,
          p.code AS project_code, p.name AS project_name,
          c.join_date, c.accepted_date
        FROM employees e
        LEFT JOIN projects p ON p.id=e.project_id
        LEFT JOIN employee_contracts c ON c.employee_id=e.id AND c.is_current=1
        WHERE e.org_id=? AND (e.id=? OR e.employee_code=?) LIMIT 1`,
      [organizationId, employeeId, employeeId]);
      if (!employee) return respond({ error: 'Karyawan tidak ditemukan' }, 404);
      if (!isActiveEmployee(employee)) return respond({ error: 'Karyawan tidak aktif' }, 409);
      const assigned = assignDefaultPasswords([employee])[0];
      const record = await passwordRecord(assigned.password);
      await d1Batch(database, [
        {
          statement: `INSERT INTO employee_credentials
            (employee_id, password_hash, password_salt, password_iterations, must_change_password,
             failed_login_attempts, locked_until, default_password_scheme, default_password_issued_at, updated_at)
            VALUES (?, ?, ?, ?, 1, 0, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            ON CONFLICT(employee_id) DO UPDATE SET
              password_hash=excluded.password_hash, password_salt=excluded.password_salt,
              password_iterations=excluded.password_iterations, must_change_password=1,
              failed_login_attempts=0, locked_until=NULL,
              default_password_scheme=excluded.default_password_scheme,
              default_password_issued_at=excluded.default_password_issued_at,
              updated_at=excluded.updated_at`,
          bindings: [employee.id, record.hash, record.salt, record.iterations, assigned.scheme],
        },
        { statement: 'DELETE FROM employee_portal_sessions WHERE employee_id=?', bindings: [employee.id] },
        {
          statement: `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
            VALUES (?, ?, ?, ?, 'EMPLOYEE_PORTAL_PASSWORD_RESET', ?, 'employee', ?)`,
          bindings: [
            `AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role,
            `${employee.employee_code || employee.id} · skema ${assigned.scheme}`, employee.id,
          ],
        },
      ]);
      return respond({
        ok: true,
        employee: {
          employeeId: employee.id,
          employeeCode: employee.employee_code || employee.id,
          name: employee.name,
          projectCode: employee.project_code || '',
          password: assigned.password,
          scheme: assigned.scheme,
        },
      });
    }

    if (action !== 'ISSUE') return respond({ error: 'Action tidak dikenali' }, 422);

    const force = Boolean(body.force);
    const limit = Math.min(Math.max(Number(body.limit) || ISSUE_BATCH_SIZE, 1), ISSUE_BATCH_SIZE);
    const rows = await d1All(database, `SELECT e.id, e.employee_code, e.name, e.status_aktif, e.created_at,
        p.code AS project_code, p.name AS project_name,
        c.join_date, c.accepted_date
      FROM employees e
      LEFT JOIN projects p ON p.id=e.project_id
      LEFT JOIN employee_contracts c ON c.employee_id=e.id AND c.is_current=1
      LEFT JOIN employee_credentials cred ON cred.employee_id=e.id
      WHERE e.org_id=?
        AND ${ACTIVE_EMPLOYEE_SQL}
        AND (${force ? '1=1' : 'cred.employee_id IS NULL'})
      ORDER BY e.id
      LIMIT ?`, [organizationId, limit]);

    const eligible = rows.filter(isActiveEmployee);
    const skipped = rows.filter((row) => !isActiveEmployee(row)).map((row) => ({
      employeeId: row.id, reason: 'inactive',
    }));
    const assigned = assignDefaultPasswords(eligible);
    const issued = [];
    for (const row of assigned) {
      const record = await passwordRecord(row.password);
      await d1Batch(database, [
        {
          statement: `INSERT INTO employee_credentials
            (employee_id, password_hash, password_salt, password_iterations, must_change_password,
             failed_login_attempts, locked_until, default_password_scheme, default_password_issued_at, updated_at)
            VALUES (?, ?, ?, ?, 1, 0, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            ON CONFLICT(employee_id) DO UPDATE SET
              password_hash=excluded.password_hash, password_salt=excluded.password_salt,
              password_iterations=excluded.password_iterations, must_change_password=1,
              failed_login_attempts=0, locked_until=NULL,
              default_password_scheme=excluded.default_password_scheme,
              default_password_issued_at=excluded.default_password_issued_at,
              updated_at=excluded.updated_at`,
          bindings: [row.id, record.hash, record.salt, record.iterations, row.scheme],
        },
        ...(force ? [{ statement: 'DELETE FROM employee_portal_sessions WHERE employee_id=?', bindings: [row.id] }] : []),
      ]);
      issued.push({
        employeeId: row.id,
        employeeCode: row.employee_code || row.id,
        name: row.name,
        projectCode: row.project_code || '',
        password: row.password,
        scheme: row.scheme,
      });
    }

    if (issued.length) {
      await d1Batch(database, [{
        statement: `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity)
          VALUES (?, ?, ?, ?, 'EMPLOYEE_PORTAL_PASSWORDS_ISSUED', ?, 'employee_credentials')`,
        bindings: [
          `AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role,
          `${issued.length} password portal diterbitkan (plaintext tidak dicatat)`,
        ],
      }]);
    }

    const summary = await d1First(database, `SELECT
      (SELECT COUNT(*) FROM employees WHERE org_id=?) AS total,
      (SELECT COUNT(*) FROM employee_credentials c JOIN employees e ON e.id=c.employee_id WHERE e.org_id=?) AS issued,
      (SELECT COUNT(*) FROM employees e LEFT JOIN employee_credentials c ON c.employee_id=e.id
        WHERE e.org_id=? AND c.employee_id IS NULL AND ${ACTIVE_EMPLOYEE_SQL}) AS pending`,
    [organizationId, organizationId, organizationId]);
    const total = Number(summary?.total || 0);
    const already = Number(summary?.issued || 0);

    return respond({
      ok: true,
      issued,
      skipped,
      processed: issued.length,
      remaining: Number(summary?.pending || 0),
      total,
      issuedCount: already,
    });
  } catch (error) {
    return respond({ error: 'Employee credential operation failed', ...publicError(error, requestId) }, 500);
  }
}
