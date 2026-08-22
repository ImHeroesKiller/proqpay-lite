import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordRecord } from '../functions/api/_account-auth.js';
import { onRequest as login } from '../functions/api/login.js';
import { onRequest as me } from '../functions/api/me.js';
import { onRequest as directory } from '../functions/api/client-projects.js';
import { onRequest as employees } from '../functions/api/employees.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';
const baseEnv = (DB) => ({ DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO' });
const request = (path, options = {}) => new Request(`${origin}${path}`, {
  ...options,
  headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(options.headers || {}) },
});

async function authenticated() {
  const DB = new D1Mock();
  const record = await passwordRecord('NativeCloudflare!2026');
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(
      'USR-ADMIN', 'ORG-OTSINDO', 'Admin', 'admin@proqpay.test', 'SUPER_ADMIN',
      record.hash, record.salt, record.iterations
    );
  const response = await login({
    request: request('/api/login', { method: 'POST', body: JSON.stringify({ email: 'admin@proqpay.test', password: 'NativeCloudflare!2026' }) }),
    env: baseEnv(DB),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { DB, env: baseEnv(DB), cookie };
}

test('D1 login creates a session accepted by /me', async () => {
  const { env, cookie } = await authenticated();
  const response = await me({ request: request('/api/me', { headers: { Cookie: cookie } }), env });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.authenticated, true);
  assert.equal(payload.authMode, 'd1');
  assert.equal(payload.user.role, 'SUPER_ADMIN');
});

test('D1 master flow creates client, project, and employee', async () => {
  const { env, cookie } = await authenticated();
  const authHeaders = { Cookie: cookie, 'Content-Type': 'application/json' };
  const createClient = await directory({
    request: request('/api/client-projects', { method: 'POST', headers: authHeaders, body: JSON.stringify({ action:'CREATE_CLIENT',id:'CLI-UAT',name:'PT UAT Native',status:'ACTIVE',npwp:'01.234.567.8-999.000',taxStatus:'PKP',billingEmail:'finance@uat.example',paymentTermsDays:30,billingMethod:'PER_EMPLOYEE',billingRate:25000,billingTaxRate:11 }) }),
    env,
  });
  assert.equal(createClient.status, 201, await createClient.text());
  const createProject = await directory({
    request: request('/api/client-projects', { method: 'POST', headers: authHeaders, body: JSON.stringify({ action:'CREATE_PROJECT',id:'PRJ-UAT',clientId:'CLI-UAT',name:'Payroll UAT',status:'ACTIVE',tier:'TIER_2_MANAGED_PAYROLL',tierEffectiveFrom:'2026-08-15',contractReference:'CTR-UAT' }) }),
    env,
  });
  assert.equal(createProject.status, 201, await createProject.text());
  const createEmployee = await employees({
    request: request('/api/employees', { method: 'POST', headers: authHeaders, body: JSON.stringify({ id: 'EMP-UAT', employeeCode: 'UAT-001', name: 'Penerima UAT', clientId: 'CLI-UAT', projectId: 'PRJ-UAT', salaryGross: 5_000_000, bankName: 'BCA', accountNo: '1234567890' }) }),
    env,
  });
  assert.equal(createEmployee.status, 200, await createEmployee.text());
  const response = await employees({ request: request('/api/employees', { headers: { Cookie: cookie } }), env });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.count, 1);
  assert.equal(payload.employees[0].employeeCode, 'UAT-001');
  assert.equal(payload.employees[0].salaryGross, 5_000_000);
  const directoryResponse=await directory({request:request('/api/client-projects',{headers:{Cookie:cookie}}),env});
  const master=await directoryResponse.json();
  assert.equal(master.clients[0].tax_status,'PKP');
  assert.equal(master.clients[0].billing_rate,25000);
  assert.equal(master.projects[0].tier,'TIER_2_MANAGED_PAYROLL');
  assert.equal(master.projects[0].contract_reference,'CTR-UAT');
});
