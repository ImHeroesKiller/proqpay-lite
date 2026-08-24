import assert from 'node:assert/strict';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { onRequest as importEmployees } from '../functions/api/import.js';
import { onRequest as employeeInit } from '../functions/api/employee/init.js';
import { onRequest as employeeLogin } from '../functions/api/employee/login.js';
import { onRequest as issueCredentials } from '../functions/api/employee-credentials.js';
import { onRequest as opsLogin } from '../functions/api/login.js';
import { passwordRecord } from '../functions/api/_account-auth.js';
import { applyEwaRepayments, markEwaRepaid } from '../functions/api/_ewa.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';
const request = (path, options = {}) => new Request(`${origin}${path}`, {
  ...options,
  headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...(options.headers || {}) },
});
const actor = { id: 'USR-PROC', email: 'processor@proqpay.test', role: 'SUPER_ADMIN', permissions: ['payment:prepare', 'payment:approve'] };

function seedPayRun(DB) {
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-RUN','ORG-OTSINDO','RUN','PT RUN');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ-RUN','ORG-OTSINDO','CLI-RUN','RUN','Project Run','seed');
    INSERT INTO client_service_plans(id,client_id,tier,effective_from,created_by,status)
      VALUES('SP-RUN','CLI-RUN','TIER_2_MANAGED_PAYROLL','2026-07-15','seed','ACTIVE');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif,email) VALUES
      ('EMP-A','ORG-OTSINDO','CLI-RUN','PRJ-RUN','A','Ani','TETAP','ani@run.test'),
      ('EMP-B','ORG-OTSINDO','CLI-RUN','PRJ-RUN','B','Budi','PKWT','budi@run.test');
    INSERT INTO employee_compensation(employee_id,basic_salary,imported_net,payroll_source_period,payroll_components)
      VALUES('EMP-A',5000000,5000000,'2026-07','{"basicSalary":9000000}'),
            ('EMP-B',6000000,6000000,'2026-07','{"basicSalary":9000000}');
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) VALUES
      ('BANK-A','EMP-A','BCA','1234567890',1),('BANK-B','EMP-B','MANDIRI','9876543210',1);
    INSERT INTO employee_assignments(id,employee_id,position,is_current) VALUES('ASG-A','EMP-A','Operator',1);
    INSERT INTO employee_contracts(id,employee_id,join_date,is_current) VALUES('CTR-A','EMP-A','2020-09-20',1);
  `);
}

async function action(database, body) {
  const response = await handleD1OperatingModel({
    request: request('/api/operating-model', { method: 'POST', body: JSON.stringify(body) }),
    env: { DB: database, DEFAULT_ORG_ID: 'ORG-OTSINDO' },
  }, actor);
  return { response, payload: await response.json() };
}

function insertDisbursed(DB, { id = 'EWA-1', employeeId = 'EMP-A', period = '2026-07', amount = 200000, fee = 50000 } = {}) {
  DB.sqlite.prepare(`INSERT INTO ewa_requests
    (id,org_id,client_id,employee_id,period,amount,fee,repayment,status,plafond_snapshot,days_worked_snapshot,tenure_months_snapshot)
    VALUES(?,?,?,?,?,?,?,?,'DISBURSED',?,?,?)`).run(
    id, 'ORG-OTSINDO', 'CLI-RUN', employeeId, period, amount, fee, amount + fee, 750000, 15, 12,
  );
}

test('FINALIZE_PAY_RUN_INPUT deducts disbursed EWA then PI uses the new net', async () => {
  const DB = new D1Mock();
  seedPayRun(DB);
  insertDisbursed(DB);
  const created = await action(DB, {
    action: 'CREATE_PAY_RUN', clientId: 'CLI-RUN', projectId: 'PRJ-RUN', servicePlanId: 'SP-RUN',
    period: '2026-07', paymentPeriod: '2026-07', paymentDate: '2026-07-25',
    runType: 'REGULAR', sourceMode: 'MASTER_CURRENT',
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const submissionId = created.payload.submission.id;
  await action(DB, {
    action: 'UPDATE_PAY_RUN_LINE', submissionId, employeeId: 'EMP-A',
    grossAmount: 5_500_000, deductionAmount: 500_000, netAmount: 5_000_000, included: true,
    components: { basicSalary: 5_500_000, taxDeduction: 500_000 },
  });
  await action(DB, {
    action: 'UPDATE_PAY_RUN_LINE', submissionId, employeeId: 'EMP-B',
    grossAmount: 6_500_000, deductionAmount: 500_000, netAmount: 6_000_000, included: true,
  });

  const finalized = await action(DB, { action: 'FINALIZE_PAY_RUN_INPUT', submissionId, confirmation: 'DATA PAYROLL FINAL' });
  assert.equal(finalized.response.status, 200, JSON.stringify(finalized.payload));
  const line = DB.sqlite.prepare('SELECT net_amount, deduction_amount, components FROM payroll_run_lines WHERE submission_id=? AND employee_id=?').get(submissionId, 'EMP-A');
  assert.equal(line.net_amount, 4_750_000);
  assert.equal(line.deduction_amount, 750_000);
  const components = JSON.parse(line.components);
  assert.equal(components.ewaRepayment, -200000);
  assert.equal(components.ewaFee, -50000);
  const ewa = DB.sqlite.prepare('SELECT status, payroll_submission_id FROM ewa_requests WHERE id=?').get('EWA-1');
  assert.equal(ewa.status, 'REPAYING');
  assert.equal(ewa.payroll_submission_id, submissionId);

  const other = DB.sqlite.prepare('SELECT net_amount FROM payroll_run_lines WHERE submission_id=? AND employee_id=?').get(submissionId, 'EMP-B');
  assert.equal(other.net_amount, 6_000_000);

  const again = await action(DB, { action: 'FINALIZE_PAY_RUN_INPUT', submissionId, confirmation: 'DATA PAYROLL FINAL' });
  assert.equal(again.response.status, 200);
  const lineAgain = DB.sqlite.prepare('SELECT net_amount FROM payroll_run_lines WHERE submission_id=? AND employee_id=?').get(submissionId, 'EMP-A');
  assert.equal(lineAgain.net_amount, 4_750_000, 'hook must be idempotent');

  const env = { DB, DEFAULT_ORG_ID: 'ORG-OTSINDO', PI_ENCRYPTION_KEY: 'uat-native-cloudflare-key-32-bytes-minimum' };
  await handleD1OperatingModel({
    request: request('/api/operating-model', { method: 'POST', body: JSON.stringify({ action: 'TRANSITION_SUBMISSION', submissionId, toState: 'SUBMITTED' }) }),
    env,
  }, actor);
  await handleD1OperatingModel({
    request: request('/api/operating-model', { method: 'POST', body: JSON.stringify({ action: 'ADVANCE_PAY_RUN', submissionId, command: 'VALIDATE', reviewConfirmed: true }) }),
    env,
  }, actor);
  await handleD1OperatingModel({
    request: request('/api/operating-model', { method: 'POST', body: JSON.stringify({ action: 'ADVANCE_PAY_RUN', submissionId, command: 'FINALIZE_PAYROLL', reviewConfirmed: true, reviewNote: 'ok' }) }),
    env,
  }, actor);
  const piResponse = await handleD1OperatingModel({
    request: request('/api/operating-model', { method: 'POST', body: JSON.stringify({ action: 'GENERATE_PAYMENT_INSTRUCTION', submissionId }) }),
    env,
  }, actor);
  assert.equal(piResponse.status, 201, await piResponse.clone().text());
  const pi = await piResponse.json();
  const aniLine = DB.sqlite.prepare('SELECT amount FROM payment_instruction_lines WHERE employee_id=?').get('EMP-A');
  assert.equal(aniLine.amount, 4_750_000);
  assert.match(pi.paymentInstruction.content_hash, /^[a-f0-9]{64}$/);
});

test('EWA repayment fails closed when remaining net would be zero or negative', async () => {
  const DB = new D1Mock();
  seedPayRun(DB);
  insertDisbursed(DB, { amount: 4_900_000, fee: 147000, period: '2026-07' });
  const created = await action(DB, {
    action: 'CREATE_PAY_RUN', clientId: 'CLI-RUN', projectId: 'PRJ-RUN', servicePlanId: 'SP-RUN',
    period: '2026-07', paymentPeriod: '2026-07', paymentDate: '2026-07-25',
    runType: 'REGULAR', sourceMode: 'MASTER_CURRENT',
  });
  const submissionId = created.payload.submission.id;
  await action(DB, {
    action: 'UPDATE_PAY_RUN_LINE', submissionId, employeeId: 'EMP-A',
    grossAmount: 5_000_000, deductionAmount: 0, netAmount: 5_000_000, included: true,
  });
  await action(DB, {
    action: 'UPDATE_PAY_RUN_LINE', submissionId, employeeId: 'EMP-B',
    grossAmount: 6_000_000, deductionAmount: 0, netAmount: 6_000_000, included: true,
  });
  await assert.rejects(applyEwaRepayments(DB, submissionId), /EWA_REPAYMENT_EXCEEDS_NET:EWA-1/);
  const line = DB.sqlite.prepare('SELECT net_amount, components FROM payroll_run_lines WHERE submission_id=? AND employee_id=?').get(submissionId, 'EMP-A');
  assert.equal(line.net_amount, 5_000_000);
  assert.equal(JSON.parse(line.components).ewaRepayment, undefined);
  assert.equal(DB.sqlite.prepare('SELECT status FROM ewa_requests WHERE id=?').get('EWA-1').status, 'DISBURSED');
});

test('legacy UPLOAD_FINAL JSON path cannot attach EWA without source provenance', async () => {
  const DB = new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI','ORG-OTSINDO','CLI','PT Client');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ','ORG-OTSINDO','CLI','PRJ','Project','seed');
    INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by)
      VALUES('SP','CLI','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-001','ORG-OTSINDO','CLI','PRJ','E001','Employee 1','ACTIVE');
    INSERT INTO ewa_requests
      (id,org_id,client_id,employee_id,period,amount,fee,repayment,status,plafond_snapshot,days_worked_snapshot,tenure_months_snapshot)
      VALUES('EWA-IMP','ORG-OTSINDO','CLI','EMP-001','2026-08',200000,50000,250000,'DISBURSED',750000,15,12);
  `);
  const rows = [{
    nrk: 'EMP-001', name: 'Employee 1', client: 'PT Client', clientCode: 'CLI',
    branch: 'Jakarta', lokasi: 'Jakarta', province: 'DKI Jakarta',
    basicSalary: 4000000, grossPay: 4000000, totalDeductions: 0, netPay: 4000000,
    bank: 'BCA', accountNo: '1234560001', payrollComponents: { basicSalary: 4000000 },
  }];
  const body = JSON.stringify({
    rows,
    context: { clientId: 'CLI', projectId: 'PRJ', servicePlanId: 'SP', tier: 'TIER_1_PAYMENT_PROCESSING', period: '2026-08' },
  });
  const response = await importEmployees({
    request: request('/api/import', { method: 'POST', body }),
    env: { DB, DEFAULT_ORG_ID: 'ORG-OTSINDO' },
  });
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json()).code, 'PAYROLL_PROVENANCE_REQUIRED');
  assert.equal(DB.sqlite.prepare('SELECT status FROM ewa_requests WHERE id=?').get('EWA-IMP').status, 'DISBURSED');
});

test('GET /api/employee/init is scoped to the session and slips come from pay-run lines only', async () => {
  const DB = new D1Mock();
  seedPayRun(DB);
  const record = await passwordRecord('NativeCloudflare!2026');
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(
    'USR-ADMIN', 'ORG-OTSINDO', 'Admin', 'admin@proqpay.test', 'SUPER_ADMIN',
    record.hash, record.salt, record.iterations,
  );
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,state,created_by)
      VALUES('SUB-A','ORG-OTSINDO','CLI-RUN','PRJ-RUN','SP-RUN','TIER_2_MANAGED_PAYROLL','2026-07','CONTROLLER_REVIEW','seed');
    INSERT INTO payroll_run_lines
      (id,submission_id,employee_id,employee_code,employee_name,bank_name,account_last4,gross_amount,deduction_amount,net_amount,components,source,included)
      VALUES('PRL-A','SUB-A','EMP-A','A','Ani','BCA','7890',5500000,500000,5000000,'{"basicSalary":5500000,"taxDeduction":500000}','MASTER_CURRENT',1),
            ('PRL-B','SUB-A','EMP-B','B','Budi','MANDIRI','3210',6500000,500000,6000000,'{"basicSalary":6500000}','MASTER_CURRENT',1);
  `);

  const ops = await opsLogin({
    request: request('/api/login', { method: 'POST', body: JSON.stringify({ email: 'admin@proqpay.test', password: 'NativeCloudflare!2026' }) }),
    env: { DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO' },
  });
  const cookie = ops.headers.get('set-cookie').split(';')[0];
  const issued = await issueCredentials({
    request: request('/api/employee-credentials', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ action: 'ISSUE', limit: 10 }) }),
    env: { DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO' },
  });
  assert.equal(issued.status, 200, await issued.clone().text());
  const issuedPayload = await issued.json();
  const password = issuedPayload.issued.find((row) => row.employeeId === 'EMP-A').password;
  DB.sqlite.prepare('UPDATE employee_credentials SET must_change_password=0 WHERE employee_id=?').run('EMP-A');
  const login = await employeeLogin({
    request: request('/api/employee/login', { method: 'POST', body: JSON.stringify({ emp_id: 'EMP-A', password }) }),
    env: { DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO' },
  });
  const session = await login.json();
  assert.equal(login.status, 200, JSON.stringify(session));

  const unauth = await employeeInit({
    request: request('/api/employee/init?emp_id=EMP-B'),
    env: { DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO' },
  });
  assert.equal(unauth.status, 401);

  const init = await employeeInit({
    request: request('/api/employee/init?emp_id=EMP-B', { headers: { Authorization: `Bearer ${session.token}` } }),
    env: { DB, AUTH_MODE: 'session', DEFAULT_ORG_ID: 'ORG-OTSINDO' },
  });
  assert.equal(init.status, 200, await init.clone().text());
  const payload = await init.json();
  assert.equal(payload.config.employee.empId, 'A');
  assert.equal(payload.config.employee.name, 'Ani');
  assert.match(payload.config.employee.bank, /•••• 7890/);
  assert.equal(payload.config.stages.length, 5);
  assert.equal(payload.config.payroll.stage, 3);
  assert.equal(payload.config.payslips.length, 1);
  assert.ok(payload.config.payslips[0].rows.some((row) => /gaji pokok/i.test(row[0]) && row[1] === 5_500_000));
  assert.ok(!payload.config.payslips.some((slip) => slip.rows.some((row) => row[1] === 9_000_000)), 'must not use overwritten compensation');
  assert.ok(!JSON.stringify(payload).includes('Budi'));
  assert.ok(!JSON.stringify(payload).includes('6_500_000') && !JSON.stringify(payload).includes('6500000'));
});

test('reconciliation MATCHED marks REPAYING EWA as REPAID', async () => {
  const DB = new D1Mock();
  seedPayRun(DB);
  insertDisbursed(DB);
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,state,created_by)
      VALUES('SUB-R','ORG-OTSINDO','CLI-RUN','PRJ-RUN','SP-RUN','TIER_2_MANAGED_PAYROLL','2026-07','COMPLETED','seed');
  `);
  DB.sqlite.prepare("UPDATE ewa_requests SET status='REPAYING', payroll_submission_id='SUB-R' WHERE id='EWA-1'").run();
  await markEwaRepaid(DB, 'SUB-R');
  assert.equal(DB.sqlite.prepare('SELECT status FROM ewa_requests WHERE id=?').get('EWA-1').status, 'REPAID');
});
