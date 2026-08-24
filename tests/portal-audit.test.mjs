import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordRecord } from '../functions/api/_account-auth.js';
import { employeeHandlePreflight } from '../functions/api/_employee-auth.js';
import { onRequest as employeeLogin } from '../functions/api/employee/login.js';
import { onRequest as issueCredentials } from '../functions/api/employee-credentials.js';
import { onRequest as opsLogin } from '../functions/api/login.js';
import { onRequest as portalAudit } from '../functions/api/portal-audit.js';
import { handlePreflight } from '../functions/api/_security.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';
const essOrigin = 'https://proqpay-ess.arywibowo.workers.dev';
const envFor = (DB) => ({
  DB,
  AUTH_MODE: 'session',
  DEFAULT_ORG_ID: 'ORG-OTSINDO',
  EMPLOYEE_PORTAL_ORIGINS: essOrigin,
});
const request = (path, options = {}) => new Request(`${origin}${path}`, {
  ...options,
  headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(options.headers || {}) },
});

async function seed(DB) {
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-OTSINDO','OTSINDO','OTSINDO');
    INSERT OR IGNORE INTO clients(id,org_id,code,name) VALUES('CLI-QJOB','ORG-OTSINDO','QJOB','PT QJOB');
    INSERT OR IGNORE INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-NOC','ORG-OTSINDO','CLI-QJOB','NOC-P1','NOC','seed');
  `);
  DB.sqlite.prepare(`INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
    VALUES(?,?,?,?,?,?,?)`).run('209200339', 'ORG-OTSINDO', 'CLI-QJOB', 'PRJ-NOC', 'EMP-209200339', 'ABDUL AZIZ', 'AKTIF');
  DB.sqlite.prepare(`INSERT INTO employee_contracts(id,employee_id,join_date,is_current) VALUES(?,?,?,1)`)
    .run('CTR-209200339', '209200339', '2020-09-20');
  const record = await passwordRecord('NativeCloudflare!2026');
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(
    'USR-ADMIN', 'ORG-OTSINDO', 'Admin', 'admin@proqpay.test', 'SUPER_ADMIN',
    record.hash, record.salt, record.iterations,
  );
}

test('employee preflight allows ESS origin and ops preflight does not', async () => {
  const env = { EMPLOYEE_PORTAL_ORIGINS: essOrigin, APP_ORIGINS: origin };
  const employeeReq = new Request(`${origin}/api/employee/login`, {
    method: 'OPTIONS',
    headers: { Origin: essOrigin, 'Access-Control-Request-Method': 'POST' },
  });
  const employee = await employeeHandlePreflight(employeeReq, env, 'POST, OPTIONS');
  assert.equal(employee.status, 204);
  assert.equal(employee.headers.get('access-control-allow-origin'), essOrigin);
  assert.match(employee.headers.get('access-control-allow-headers') || '', /Authorization/);

  const opsReq = new Request(`${origin}/api/ewa`, {
    method: 'OPTIONS',
    headers: { Origin: essOrigin, 'Access-Control-Request-Method': 'GET' },
  });
  const ops = handlePreflight(opsReq, env, 'GET, OPTIONS');
  assert.equal(ops.status, 403);
});

test('portal audit lists login attempts without reading payroll tables', async () => {
  const DB = new D1Mock();
  await seed(DB);
  const env = envFor(DB);
  const ops = await opsLogin({
    request: request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@proqpay.test', password: 'NativeCloudflare!2026' }),
    }),
    env,
  });
  const cookie = ops.headers.get('set-cookie').split(';')[0];
  await issueCredentials({
    request: request('/api/employee-credentials', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ action: 'ISSUE', limit: 10 }),
    }),
    env,
  });

  const failed = await employeeLogin({
    request: request('/api/employee/login', {
      method: 'POST',
      body: JSON.stringify({ emp_id: '209200339', password: 'wrong-password-value' }),
    }),
    env,
  });
  assert.equal(failed.status, 401);

  const audit = await portalAudit({
    request: request('/api/portal-audit', { headers: { Cookie: cookie } }),
    env,
  });
  assert.equal(audit.status, 200, await audit.clone().text());
  const body = await audit.json();
  assert.equal(body.ok, true);
  assert.ok(body.logins.some((row) => row.employee_id === '209200339' && Number(row.success) === 0));
  assert.ok(body.events.some((row) => row.action === 'EMPLOYEE_PORTAL_PASSWORDS_ISSUED'));
  const payrollTouched = DB.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM payroll_run_lines",
  ).get();
  assert.equal(payrollTouched.n, 0);
});
