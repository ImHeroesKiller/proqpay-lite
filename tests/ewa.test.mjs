import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordRecord } from '../functions/api/_account-auth.js';
import { ewaEligibility, ewaFee, ewaPlafond, payrollStageIndex, tenureDaysFromJoin, tenureMonthsFromJoin } from '../functions/api/_ewa.js';
import { onRequest as ewaOps } from '../functions/api/ewa.js';
import { onRequest as employeeEwa } from '../functions/api/employee/ewa.js';
import { onRequest as employeeLogin } from '../functions/api/employee/login.js';
import { onRequest as issueCredentials } from '../functions/api/employee-credentials.js';
import { onRequest as opsLogin } from '../functions/api/login.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';
const envFor = (DB) => ({ DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO' });
const request = (path, options = {}) => new Request(`${origin}${path}`, {
  ...options,
  headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(options.headers || {}) },
});

test('EWA fee and plafond are deterministic', () => {
  assert.equal(ewaFee(1_000_000), 50000);
  assert.equal(ewaFee(2_000_000), 60000);
  assert.equal(ewaPlafond({ net: 5_000_000, daysWorked: 15, daysInMonth: 30, maxPercent: 0.3 }), 750000);
  assert.equal(payrollStageIndex('PAYMENT_APPROVAL_PENDING'), 4);
  assert.equal(payrollStageIndex('COMPLETED'), 5);
});

test('tenure is counted from join date, not from day-of-month setting', () => {
  const now = new Date('2026-08-24T04:00:00Z');
  assert.equal(tenureDaysFromJoin('2026-08-16', now), 8);
  assert.equal(tenureMonthsFromJoin('2026-08-16', now), 0);
  assert.equal(tenureMonthsFromJoin('2026-07-24', now), 1);
  assert.equal(tenureMonthsFromJoin('2026-07-25', now), 0);
  assert.equal(tenureDaysFromJoin('', now), 0);

  const blocked = ewaEligibility({
    policy: { enabled: 1, min_tenure_months: 1, min_tenure_days: 0, min_days_worked: 10 },
    daysWorked: 24, tenureMonths: 0, tenureDays: 8, joinDate: '2026-08-16', plafond: 500000,
  });
  assert.equal(blocked.eligible, false);
  assert.match(blocked.reason, /bergabung/);
  assert.match(blocked.reason, /2026/);
  assert.match(blocked.reason, /1 bulan/);

  const daysOk = ewaEligibility({
    policy: { enabled: 1, min_tenure_months: 0, min_tenure_days: 10, min_days_worked: 10 },
    daysWorked: 24, tenureMonths: 0, tenureDays: 12, joinDate: '2026-08-12', plafond: 500000,
  });
  assert.equal(daysOk.eligible, true);

  const daysShort = ewaEligibility({
    policy: { enabled: 1, min_tenure_months: 0, min_tenure_days: 10, min_days_worked: 10 },
    daysWorked: 24, tenureMonths: 0, tenureDays: 8, joinDate: '2026-08-16', plafond: 500000,
  });
  assert.equal(daysShort.eligible, false);
  assert.match(daysShort.reason, /Minimal 10 hari/);
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
  DB.sqlite.prepare(`INSERT INTO employee_compensation(employee_id,basic_salary,imported_net) VALUES(?,?,?)`)
    .run('209200339', 5000000, 5080602);
  const record = await passwordRecord('NativeCloudflare!2026');
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(
    'USR-ADMIN', 'ORG-OTSINDO', 'Admin', 'admin@proqpay.test', 'SUPER_ADMIN',
    record.hash, record.salt, record.iterations,
  );
}

async function employeeToken(DB) {
  const ops = await opsLogin({
    request: request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@proqpay.test', password: 'NativeCloudflare!2026' }),
    }),
    env: envFor(DB),
  });
  const cookie = ops.headers.get('set-cookie').split(';')[0];
  const issued = await issueCredentials({
    request: request('/api/employee-credentials', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ action: 'ISSUE', limit: 10 }),
    }),
    env: envFor(DB),
  });
  const payload = await issued.json();
  const password = payload.issued[0].password;
  DB.sqlite.prepare('UPDATE employee_credentials SET must_change_password=0 WHERE employee_id=?').run('209200339');
  const login = await employeeLogin({
    request: request('/api/employee/login', {
      method: 'POST',
      body: JSON.stringify({ emp_id: '209200339', password }),
    }),
    env: envFor(DB),
  });
  const body = await login.json();
  return body.token;
}

test('employee can submit EWA and ops can approve without touching payroll tables', async () => {
  const DB = new D1Mock();
  await seed(DB);
  const token = await employeeToken(DB);
  const quote = await employeeEwa({
    request: request('/api/employee/ewa', { headers: { Authorization: `Bearer ${token}` } }),
    env: envFor(DB),
  });
  const preview = await quote.json();
  assert.equal(quote.status, 200);
  assert.equal(preview.ok, true);
  assert.ok(preview.plafond >= 0);

  const submit = await employeeEwa({
    request: request('/api/employee/ewa', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: Math.max(100000, Math.min(preview.plafond, 200000)), agreed: true }),
    }),
    env: envFor(DB),
  });
  const created = await submit.json();
  if (preview.eligible) {
    assert.equal(submit.status, 200, JSON.stringify(created));
    assert.equal(created.request.status, 'SUBMITTED');
    const ops = await opsLogin({
      request: request('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@proqpay.test', password: 'NativeCloudflare!2026' }),
      }),
      env: envFor(DB),
    });
    const cookie = ops.headers.get('set-cookie').split(';')[0];
    const approve = await ewaOps({
      request: request('/api/ewa', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ id: created.request.id, action: 'APPROVE' }),
      }),
      env: envFor(DB),
    });
    assert.equal(approve.status, 200);
    const payroll = DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payroll_submissions'").get();
    assert.ok(payroll);
    const count = DB.sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_submissions').get();
    assert.equal(count.n, 0);
  } else {
    assert.equal(submit.status, 409);
  }
});
