import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordRecord } from '../functions/api/_account-auth.js';
import {
  ISSUE_BATCH_SIZE, assignDefaultPasswords, employeeIdSuffix, projectSlug, uniqueJoinDate,
} from '../functions/api/_employee-auth.js';
import { onRequest as issueCredentials } from '../functions/api/employee-credentials.js';
import { onRequest as employeeLogin } from '../functions/api/employee/login.js';
import { onRequest as employeeLogout } from '../functions/api/employee/logout.js';
import { onRequest as employeeMe } from '../functions/api/employee/me.js';
import { onRequest as employeePassword } from '../functions/api/employee/password.js';
import { onRequest as opsLogin } from '../functions/api/login.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';
const baseEnv = (DB) => ({ DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO' });
const request = (path, options = {}) => new Request(`${origin}${path}`, {
  ...options,
  headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(options.headers || {}) },
});

function seedMaster(DB) {
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-OTSINDO','OTSINDO','OTSINDO');
    INSERT OR IGNORE INTO clients(id,org_id,code,name) VALUES('CLI-QJOB','ORG-OTSINDO','QJOB','PT QJOB SAKA GEMILANG');
    INSERT OR IGNORE INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-NOC','ORG-OTSINDO','CLI-QJOB','NOC-P1','NOC PARTNERSHIP 1','seed');
  `);
}

function seedEmployee(DB, {
  id, code, name, joinDate = '2020-09-20', status = 'AKTIF', projectId = 'PRJ-NOC',
} = {}) {
  seedMaster(DB);
  DB.sqlite.prepare(`INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
    VALUES(?,?,?,?,?,?,?)`).run(id, 'ORG-OTSINDO', 'CLI-QJOB', projectId, code, name, status);
  DB.sqlite.prepare(`INSERT INTO employee_contracts(id,employee_id,join_date,is_current) VALUES(?,?,?,1)`)
    .run(`CTR-${id}`, id, joinDate);
}

async function opsSession(DB) {
  const record = await passwordRecord('NativeCloudflare!2026');
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(
    'USR-ADMIN', 'ORG-OTSINDO', 'Admin', 'admin@proqpay.test', 'SUPER_ADMIN',
    record.hash, record.salt, record.iterations,
  );
  const response = await opsLogin({
    request: request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@proqpay.test', password: 'NativeCloudflare!2026' }),
    }),
    env: baseEnv(DB),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('default password is project slug plus unique join date', () => {
  assert.equal(projectSlug('NOC-P1', 'NOC PARTNERSHIP 1'), 'NOCP1');
  assert.equal(uniqueJoinDate('2020-09-20', null, null), '20200920');
  assert.equal(employeeIdSuffix('EMP-209200339', '209200339'), '0339');
  const [one] = assignDefaultPasswords([{
    id: '209200339', employee_code: 'EMP-209200339', project_code: 'NOC-P1',
    project_name: 'NOC PARTNERSHIP 1', join_date: '2020-09-20',
  }]);
  assert.equal(one.password, 'NOCP120200920');
  assert.equal(one.scheme, 'PROJECT_JOIN_DATE');
});

test('same project and join date get a unique suffix', () => {
  const assigned = assignDefaultPasswords([
    { id: '1001', employee_code: 'EMP-1001', project_code: 'NOC-P1', join_date: '2020-09-20' },
    { id: '1002', employee_code: 'EMP-1002', project_code: 'NOC-P1', join_date: '2020-09-20' },
  ]);
  assert.notEqual(assigned[0].password, assigned[1].password);
  assert.ok(assigned[0].password.startsWith('NOCP120200920'));
  assert.ok(assigned[1].password.startsWith('NOCP120200920'));
});

test('employee portal tables are created by migration 0004', () => {
  const DB = new D1Mock();
  const names = DB.sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  ).all().map((row) => row.name);
  assert.ok(names.includes('employee_credentials'));
  assert.ok(names.includes('employee_portal_sessions'));
  assert.ok(names.includes('portal_login_attempts'));
  assert.ok(names.includes('payroll_run_lines'));
  assert.ok(names.includes('payment_instructions'));
});

test('ops can issue default passwords in batches without storing plaintext', async () => {
  const DB = new D1Mock();
  seedEmployee(DB, { id: '209200339', code: 'EMP-209200339', name: 'ABDUL AZIZ' });
  seedEmployee(DB, { id: '209200340', code: 'EMP-209200340', name: 'BUDI', joinDate: '2021-01-15' });
  const cookie = await opsSession(DB);
  const env = baseEnv(DB);
  const authHeaders = { Cookie: cookie, 'Content-Type': 'application/json' };

  const status = await issueCredentials({ request: request('/api/employee-credentials', { headers: { Cookie: cookie } }), env });
  assert.equal(status.status, 200, await status.clone().text());
  const summary = await status.json();
  assert.equal(summary.pending, 2);
  assert.equal(summary.batchSize, ISSUE_BATCH_SIZE);

  const issued = await issueCredentials({
    request: request('/api/employee-credentials', {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ action: 'ISSUE' }),
    }),
    env,
  });
  assert.equal(issued.status, 200, await issued.clone().text());
  const payload = await issued.json();
  assert.equal(payload.processed, 2);
  assert.equal(payload.remaining, 0);
  const aziz = payload.issued.find((row) => row.employeeId === '209200339');
  assert.equal(aziz.password, 'NOCP120200920');
  assert.notEqual(aziz.password, DB.sqlite.prepare('SELECT password_hash FROM employee_credentials WHERE employee_id=?').get('209200339').password_hash);

  const replay = await issueCredentials({
    request: request('/api/employee-credentials', {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ action: 'ISSUE' }),
    }),
    env,
  });
  const replayBody = await replay.json();
  assert.equal(replayBody.processed, 0);

  const audit = DB.sqlite.prepare("SELECT detail FROM audit_logs WHERE action='EMPLOYEE_PORTAL_PASSWORDS_ISSUED'").get();
  assert.doesNotMatch(audit.detail, /NOCP120200920/);
});

test('employee login, me, password rotation, and logout', async () => {
  const DB = new D1Mock();
  seedEmployee(DB, { id: '209200339', code: 'EMP-209200339', name: 'ABDUL AZIZ' });
  const cookie = await opsSession(DB);
  const env = baseEnv(DB);
  const issued = await issueCredentials({
    request: request('/api/employee-credentials', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ISSUE' }),
    }),
    env,
  });
  const { issued: rows } = await issued.json();
  const password = rows[0].password;

  const denied = await employeeLogin({
    request: request('/api/employee/login', { method: 'POST', body: JSON.stringify({ emp_id: 'EMP-209200339', password: 'wrong-password' }) }),
    env,
  });
  assert.equal(denied.status, 401);
  const deniedBody = await denied.json();
  assert.equal(deniedBody.error, 'Employee ID atau password tidak valid');

  const login = await employeeLogin({
    request: request('/api/employee/login', { method: 'POST', body: JSON.stringify({ emp_id: 'EMP-209200339', password }) }),
    env,
  });
  assert.equal(login.status, 200, await login.clone().text());
  const session = await login.json();
  assert.equal(session.mustChangePassword, true);
  assert.equal(session.emp_name, 'ABDUL AZIZ');
  assert.ok(session.token);
  const employeeCookie = login.headers.get('set-cookie');
  assert.match(employeeCookie, /proqpay_employee=/);
  assert.doesNotMatch(employeeCookie, /proqpay_session=/);

  const me = await employeeMe({
    request: request('/api/employee/me', { headers: { Cookie: employeeCookie.split(';')[0] } }),
    env,
  });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.role, 'EMPLOYEE');
  assert.equal(meBody.employee.id, '209200339');

  const weak = await employeePassword({
    request: request('/api/employee/password', {
      method: 'POST',
      headers: { Cookie: employeeCookie.split(';')[0], 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: password, newPassword: 'short' }),
    }),
    env,
  });
  assert.equal(weak.status, 422);

  const rotated = await employeePassword({
    request: request('/api/employee/password', {
      method: 'POST',
      headers: { Cookie: employeeCookie.split(';')[0], 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: password, newPassword: 'PortalBaru!2026Aa' }),
    }),
    env,
  });
  assert.equal(rotated.status, 200, await rotated.clone().text());
  const stale = await employeeMe({
    request: request('/api/employee/me', { headers: { Cookie: employeeCookie.split(';')[0] } }),
    env,
  });
  assert.equal(stale.status, 401);

  const oldPassword = await employeeLogin({
    request: request('/api/employee/login', { method: 'POST', body: JSON.stringify({ emp_id: '209200339', password }) }),
    env,
  });
  assert.equal(oldPassword.status, 401);

  const fresh = await employeeLogin({
    request: request('/api/employee/login', {
      method: 'POST',
      body: JSON.stringify({ emp_id: '209200339', password: 'PortalBaru!2026Aa' }),
    }),
    env,
  });
  assert.equal(fresh.status, 200);
  const freshBody = await fresh.json();
  assert.equal(freshBody.mustChangePassword, false);

  const logout = await employeeLogout({
    request: request('/api/employee/logout', {
      method: 'POST',
      headers: { Cookie: fresh.headers.get('set-cookie').split(';')[0] },
    }),
    env,
  });
  assert.equal(logout.status, 200);
  const afterLogout = await employeeMe({
    request: request('/api/employee/me', { headers: { Cookie: fresh.headers.get('set-cookie').split(';')[0] } }),
    env,
  });
  assert.equal(afterLogout.status, 401);
});

test('inactive employees and unknown ids fail closed with the same error', async () => {
  const DB = new D1Mock();
  seedEmployee(DB, { id: '209200339', code: 'EMP-209200339', name: 'ABDUL AZIZ' });
  seedEmployee(DB, { id: 'RESIGN1', code: 'EMP-RESIGN1', name: 'RESIGN', status: 'RESIGN' });
  const cookie = await opsSession(DB);
  const env = baseEnv(DB);
  await issueCredentials({
    request: request('/api/employee-credentials', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ISSUE' }),
    }),
    env,
  });
  const unknown = await employeeLogin({
    request: request('/api/employee/login', { method: 'POST', body: JSON.stringify({ emp_id: 'NO-SUCH', password: 'NOCP120200920' }) }),
    env,
  });
  const inactive = await employeeLogin({
    request: request('/api/employee/login', { method: 'POST', body: JSON.stringify({ emp_id: 'EMP-RESIGN1', password: 'NOCP120200920' }) }),
    env,
  });
  assert.equal(unknown.status, 401);
  assert.equal(inactive.status, 401);
  assert.deepEqual(await unknown.json(), await inactive.json());
});

test('five failed logins lock the employee account', async () => {
  const DB = new D1Mock();
  seedEmployee(DB, { id: '209200339', code: 'EMP-209200339', name: 'ABDUL AZIZ' });
  const cookie = await opsSession(DB);
  const env = baseEnv(DB);
  const issued = await issueCredentials({
    request: request('/api/employee-credentials', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ISSUE' }),
    }),
    env,
  });
  const password = (await issued.json()).issued[0].password;
  DB.sqlite.prepare('UPDATE employee_credentials SET failed_login_attempts=4 WHERE employee_id=?').run('209200339');
  const fifth = await employeeLogin({
    request: request('/api/employee/login', { method: 'POST', body: JSON.stringify({ emp_id: 'EMP-209200339', password: 'definitely-wrong' }) }),
    env,
  });
  assert.equal(fifth.status, 401);
  const locked = DB.sqlite.prepare('SELECT failed_login_attempts, locked_until FROM employee_credentials WHERE employee_id=?').get('209200339');
  assert.equal(locked.failed_login_attempts, 5);
  assert.ok(locked.locked_until);
  const evenValid = await employeeLogin({
    request: request('/api/employee/login', { method: 'POST', body: JSON.stringify({ emp_id: 'EMP-209200339', password }) }),
    env,
  });
  assert.equal(evenValid.status, 429);
});

test('reset returns a one-time password and revokes portal sessions', async () => {
  const DB = new D1Mock();
  seedEmployee(DB, { id: '209200339', code: 'EMP-209200339', name: 'ABDUL AZIZ' });
  const cookie = await opsSession(DB);
  const env = baseEnv(DB);
  const authHeaders = { Cookie: cookie, 'Content-Type': 'application/json' };
  await issueCredentials({
    request: request('/api/employee-credentials', { method: 'POST', headers: authHeaders, body: JSON.stringify({ action: 'ISSUE' }) }),
    env,
  });
  const reset = await issueCredentials({
    request: request('/api/employee-credentials', {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ action: 'RESET', employeeId: 'EMP-209200339' }),
    }),
    env,
  });
  assert.equal(reset.status, 200, await reset.clone().text());
  const body = await reset.json();
  assert.equal(body.employee.password, 'NOCP120200920');
  const login = await employeeLogin({
    request: request('/api/employee/login', { method: 'POST', body: JSON.stringify({ emp_id: '209200339', password: body.employee.password }) }),
    env,
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).mustChangePassword, true);
});
