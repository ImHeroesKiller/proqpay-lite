import assert from 'node:assert/strict';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { onRequest as paymentProof } from '../functions/api/payment-proof.js';
import { createSession } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';
const request = (path, options = {}) => new Request(`${origin}${path}`, {
  ...options,
  headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...(options.headers || {}) },
});
const post = (action) => request('/api/operating-model', { method: 'POST', body: JSON.stringify(action) });

class R2Mock {
  constructor() { this.objects = new Map(); }
  async put(key, value, options = {}) { this.objects.set(key, { value, ...options }); }
  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return { body: object.value, customMetadata: object.customMetadata,
      writeHttpMetadata(headers) { if (object.httpMetadata?.contentType) headers.set('Content-Type', object.httpMetadata.contentType); } };
  }
  async delete(key) { this.objects.delete(key); }
}

function seed396(DB) {
  const sql = DB.sqlite;
  sql.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-UAT','ORG-OTSINDO','UAT','PT UAT');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ-UAT','ORG-OTSINDO','CLI-UAT','PRJ-UAT','Payroll UAT','seed');
    INSERT INTO client_service_plans(id,client_id,tier,effective_from,created_by,status)
      VALUES('SP-UAT','CLI-UAT','TIER_1_PAYMENT_PROCESSING','2026-01-01','seed','ACTIVE');
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,created_by)
      VALUES('SUB-UAT','ORG-OTSINDO','CLI-UAT','PRJ-UAT','SP-UAT','TIER_1_PAYMENT_PROCESSING','2026-08','2026-08','PAYMENT_INSTRUCTION_READY','seed');
  `);
  const employee = sql.prepare(`INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
    VALUES(?,?,?,?,?,?,'ACTIVE')`);
  const compensation = sql.prepare(`INSERT INTO employee_compensation
    (employee_id,basic_salary,payroll_source_period,imported_gross,imported_deduction,imported_net)
    VALUES(?,?,?, ?,?,?)`);
  const bank = sql.prepare(`INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
    VALUES(?,?,?,?,1)`);
  sql.exec('BEGIN');
  for (let index = 1; index <= 396; index += 1) {
    const id = `EMP-${String(index).padStart(3, '0')}`;
    const net = 4_000_000 + index;
    employee.run(id, 'ORG-OTSINDO', 'CLI-UAT', 'PRJ-UAT', `UAT-${index}`, `Penerima ${index}`);
    compensation.run(id, net, '2026-08', net, 0, net);
    bank.run(`BANK-${index}`, id, index % 2 ? 'BCA' : 'MANDIRI', `123456${String(index).padStart(4, '0')}`);
  }
  sql.exec('COMMIT');
}

test('D1 processes 396 recipients through PI approval, proof, and reconciliation', async () => {
  const DB = new D1Mock();
  seed396(DB);
  const env = { DB, FILES: new R2Mock(), DEFAULT_ORG_ID: 'ORG-OTSINDO', PI_ENCRYPTION_KEY: 'uat-native-cloudflare-key-32-bytes-minimum' };
  const maker = { id: 'USR-MAKER', email: 'maker@proqpay.test', role: 'PAYROLL_PROCESSOR', permissions: ['payment:prepare'] };
  const approver = { id: 'USR-APPROVER', email: 'approver@proqpay.test', role: 'PAYROLL_CONTROLLER', permissions: ['payment:approve'] };

  const dashboardResponse = await handleD1OperatingModel({ request: request('/api/operating-model?resource=dashboard', { method: 'GET' }), env }, maker);
  assert.equal(dashboardResponse.status, 200, await dashboardResponse.clone().text());
  const dashboard = await dashboardResponse.json();
  assert.deepEqual(dashboard.portfolioSummary, {
    clients: 1, projects: 1, employees: 396, activeEmployees: 396, primaryAccounts: 396, bankCoveragePercent: 100,
  });

  const generated = await handleD1OperatingModel({ request: post({ action: 'GENERATE_PAYMENT_INSTRUCTION', submissionId: 'SUB-UAT' }), env }, maker);
  assert.equal(generated.status, 201, await generated.clone().text());
  const generatedPayload = await generated.json();
  const pi = generatedPayload.paymentInstruction;
  assert.equal(pi.recipient_count, 396);
  assert.match(pi.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(pi.status, 'PAYMENT_INSTRUCTION_READY');

  const detailResponse = await handleD1OperatingModel({ request: request(`/api/operating-model?resource=payment-instruction-detail&paymentInstructionId=${pi.id}`, { method: 'GET' }), env }, maker);
  const detail = await detailResponse.json();
  assert.equal(detail.lines.length, 396);
  assert.equal(detail.control.balanced, true);
  assert.ok(detail.lines.every((line) => !('account_ciphertext' in line)));

  const submitted = await handleD1OperatingModel({ request: post({ action: 'SUBMIT_PAYMENT_INSTRUCTION', paymentInstructionId: pi.id, confirmation: 'SUBMIT PI' }), env }, maker);
  assert.equal(submitted.status, 200, await submitted.clone().text());
  const approved = await handleD1OperatingModel({ request: post({ action: 'APPROVE_PAYMENT', paymentInstructionId: pi.id, actionHash: pi.content_hash, confirmation: 'KONFIRMASI PAYMENT' }), env }, approver);
  assert.equal(approved.status, 200, await approved.clone().text());

  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE','test-hash','test-salt',100000,0,0,'seed')`).run(
    maker.id, 'ORG-OTSINDO', 'Payment Processor', maker.email, maker.role
  );
  const session = await createSession(DB, maker.id, env);
  env.AUTH_MODE = 'session';

  const form = new FormData();
  form.set('paymentInstructionId', pi.id);
  form.set('bank', 'BCA');
  form.set('reference', 'REF-UAT');
  form.set('transactionDate', '2026-08-25');
  form.set('amount', String(pi.expected_total));
  form.set('file', new File([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34])], 'proof.pdf', { type: 'application/pdf' }));
  const proofResponse = await paymentProof({ request: new Request(`${origin}/api/payment-proof`, {
    method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', Cookie: `proqpay_session=${session.token}` }, body: form,
  }), env });
  assert.equal(proofResponse.status, 201, await proofResponse.clone().text());
  assert.equal(env.FILES.objects.size, 1);
  const reconciled = await handleD1OperatingModel({ request: post({ action: 'RECONCILE_PAYMENT', paymentInstructionId: pi.id }), env }, approver);
  assert.equal(reconciled.status, 200, await reconciled.clone().text());
  const reconciliation = (await reconciled.json()).reconciliation;
  assert.equal(reconciliation.status, 'MATCHED');
  assert.equal(reconciliation.difference, 0);

  assert.throws(() => DB.sqlite.prepare('UPDATE payment_instruction_lines SET amount=1 WHERE payment_instruction_id=?').run(pi.id), /immutable/);
});

test('Controller approval publishes exactly one PI atomically and retries idempotently', async () => {
  const DB = new D1Mock();
  seed396(DB);
  DB.sqlite.prepare(`UPDATE payroll_submissions SET state='CONTROLLER_REVIEW' WHERE id='SUB-UAT'`).run();
  const env = { DB, DEFAULT_ORG_ID:'ORG-OTSINDO', PI_ENCRYPTION_KEY:'uat-native-cloudflare-key-32-bytes-minimum' };
  const controller = { id:'USR-CONTROLLER', email:'controller@proqpay.test', role:'PAYROLL_CONTROLLER', permissions:['payment:approve'] };
  const payload = { action:'APPROVE_PAYROLL_AND_GENERATE_PI', submissionId:'SUB-UAT', reviewConfirmed:true,
    reviewNote:'Control total, daftar penerima, dan rekening telah diverifikasi.' };

  const approved = await handleD1OperatingModel({ request:post(payload), env }, controller);
  assert.equal(approved.status,201,await approved.clone().text());
  const first = (await approved.json()).paymentInstruction;
  assert.equal(first.status,'PAYMENT_INSTRUCTION_READY');
  assert.equal(DB.sqlite.prepare(`SELECT state FROM payroll_submissions WHERE id='SUB-UAT'`).get().state,'PAYMENT_INSTRUCTION_READY');
  assert.equal(DB.sqlite.prepare(`SELECT COUNT(*) AS count FROM payment_instructions WHERE submission_id='SUB-UAT' AND status<>'REJECTED'`).get().count,1);

  const replay = await handleD1OperatingModel({ request:post(payload), env }, controller);
  assert.equal(replay.status,200,await replay.clone().text());
  const replayPayload = await replay.json();
  assert.equal(replayPayload.idempotentReplay,true);
  assert.equal(replayPayload.paymentInstruction.id,first.id);
  assert.equal(DB.sqlite.prepare(`SELECT COUNT(*) AS count FROM payment_instructions WHERE submission_id='SUB-UAT' AND status<>'REJECTED'`).get().count,1);
});

test('rejected PI returns to Processor and creates a new immutable revision', async () => {
  const DB = new D1Mock();
  seed396(DB);
  const env = { DB, FILES: new R2Mock(), DEFAULT_ORG_ID: 'ORG-OTSINDO', PI_ENCRYPTION_KEY: 'uat-native-cloudflare-key-32-bytes-minimum' };
  const maker = { id: 'USR-MAKER', email: 'maker@proqpay.test', role: 'PAYROLL_PROCESSOR', permissions: ['payment:prepare'] };
  const controller = { id: 'USR-CONTROLLER', email: 'controller@proqpay.test', role: 'PAYROLL_CONTROLLER', permissions: ['payment:approve'] };

  const firstResponse = await handleD1OperatingModel({ request: post({ action:'GENERATE_PAYMENT_INSTRUCTION', submissionId:'SUB-UAT' }), env }, maker);
  const first = (await firstResponse.json()).paymentInstruction;
  await handleD1OperatingModel({ request: post({ action:'SUBMIT_PAYMENT_INSTRUCTION', paymentInstructionId:first.id, confirmation:'SUBMIT PI' }), env }, maker);
  const rejectedResponse = await handleD1OperatingModel({ request: post({ action:'REJECT_PAYMENT', paymentInstructionId:first.id, reason:'Nominal penerima pertama harus diperbaiki' }), env }, controller);
  assert.equal(rejectedResponse.status, 200, await rejectedResponse.clone().text());

  DB.sqlite.prepare(`UPDATE employee_compensation SET imported_net=imported_net+1000,imported_gross=imported_gross+1000 WHERE employee_id='EMP-001'`).run();
  DB.sqlite.prepare(`UPDATE payroll_submissions SET state='PAYMENT_INSTRUCTION_READY' WHERE id='SUB-UAT'`).run();
  const revisedResponse = await handleD1OperatingModel({ request: post({ action:'GENERATE_PAYMENT_INSTRUCTION', submissionId:'SUB-UAT' }), env }, maker);
  assert.equal(revisedResponse.status, 201, await revisedResponse.clone().text());
  const revised = (await revisedResponse.json()).paymentInstruction;
  assert.notEqual(revised.id, first.id);
  assert.notEqual(revised.content_hash, first.content_hash);
  assert.equal(revised.status, 'PAYMENT_INSTRUCTION_READY');
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_instructions WHERE id=?').get(first.id).status, 'REJECTED');

  const listResponse = await handleD1OperatingModel({ request: request('/api/operating-model?resource=payment-instructions', { method:'GET' }), env }, maker);
  const rows = (await listResponse.json()).paymentInstructions;
  const rejected = rows.find((row) => row.id === first.id);
  assert.equal(rejected.rejection_reason, 'Nominal penerima pertama harus diperbaiki');
});

test('Processor applies an audited bank correction and generates a new PI revision', async () => {
  const DB = new D1Mock(); seed396(DB);
  DB.sqlite.prepare(`INSERT INTO payroll_run_lines(id,submission_id,employee_id,employee_code,employee_name,bank_name,account_last4,gross_amount,deduction_amount,net_amount,source)
    SELECT 'LINE-001','SUB-UAT',e.id,e.employee_code,e.name,'BCA','0001',4000001,0,4000001,'UPLOAD_FINAL' FROM employees e WHERE e.id='EMP-001'`).run();
  const env={DB,DEFAULT_ORG_ID:'ORG-OTSINDO',PI_ENCRYPTION_KEY:'uat-native-cloudflare-key-32-bytes-minimum'};
  const maker={id:'USR-MAKER',email:'maker@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:['payment:prepare']};
  const controller={id:'USR-CONTROLLER',email:'controller@proqpay.test',role:'PAYROLL_CONTROLLER',permissions:['payment:approve']};
  const first=(await (await handleD1OperatingModel({request:post({action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:'SUB-UAT'}),env},maker)).json()).paymentInstruction;
  await handleD1OperatingModel({request:post({action:'SUBMIT_PAYMENT_INSTRUCTION',paymentInstructionId:first.id,confirmation:'SUBMIT PI'}),env},maker);
  await handleD1OperatingModel({request:post({action:'REJECT_PAYMENT',paymentInstructionId:first.id,reason:'Nomor rekening penerima pertama tidak sesuai'}),env},controller);
  const correction=await handleD1OperatingModel({request:post({action:'APPLY_BANK_CORRECTIONS',submissionId:'SUB-UAT',paymentInstructionId:first.id,
    confirmation:'TERAPKAN KOREKSI REKENING',corrections:[{employeeId:'EMP-001',bankName:'MANDIRI',accountNo:'998877665544'}]}),env},maker);
  assert.equal(correction.status,200,await correction.clone().text());
  const correctedLine=DB.sqlite.prepare(`SELECT bank_name,account_last4 FROM payroll_run_lines WHERE id='LINE-001'`).get();
  assert.equal(correctedLine.bank_name,'MANDIRI');
  assert.equal(correctedLine.account_last4,'5544');
  assert.equal(DB.sqlite.prepare(`SELECT account_no FROM employee_bank_accounts WHERE employee_id='EMP-001' AND is_primary=1`).get().account_no,'998877665544');
  assert.equal(DB.sqlite.prepare(`SELECT state FROM payroll_submissions WHERE id='SUB-UAT'`).get().state,'PAYMENT_INSTRUCTION_READY');
  const revisedResponse=await handleD1OperatingModel({request:post({action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:'SUB-UAT'}),env},maker);
  assert.equal(revisedResponse.status,201,await revisedResponse.clone().text());
  const revised=(await revisedResponse.json()).paymentInstruction;
  assert.notEqual(revised.id,first.id);
  assert.equal(DB.sqlite.prepare(`SELECT account_last4 FROM payment_instruction_lines WHERE payment_instruction_id=?`).get(revised.id).account_last4,'5544');
  const audit=DB.sqlite.prepare(`SELECT detail FROM audit_logs WHERE action='PI_BANK_CORRECTIONS_APPLIED'`).get();
  assert.ok(audit.detail.includes('5544'));
  assert.ok(!audit.detail.includes('998877665544'));
});

test('Processor resubmits an unchanged rejected PI as a distinct immutable revision', async () => {
  const DB = new D1Mock();
  seed396(DB);
  const env = { DB, FILES: new R2Mock(), DEFAULT_ORG_ID: 'ORG-OTSINDO', PI_ENCRYPTION_KEY: 'uat-native-cloudflare-key-32-bytes-minimum' };
  const maker = { id:'USR-MAKER', email:'maker@proqpay.test', role:'PAYROLL_PROCESSOR', permissions:['payment:prepare'] };
  const recoveryMaker = { id:'USR-RECOVERY', email:'recovery@proqpay.test', role:'PAYROLL_PROCESSOR', permissions:['payment:prepare'] };
  const controller = { id:'USR-CONTROLLER', email:'controller@proqpay.test', role:'PAYROLL_CONTROLLER', permissions:['payment:approve'] };
  const client = { id:'USR-CLIENT', email:'client@proqpay.test', role:'CLIENT_USER', permissions:[], clientIds:['CLI-UAT'], projectIds:['PRJ-UAT'] };

  const first = (await (await handleD1OperatingModel({ request:post({action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:'SUB-UAT'}),env },maker)).json()).paymentInstruction;
  await handleD1OperatingModel({ request:post({action:'SUBMIT_PAYMENT_INSTRUCTION',paymentInstructionId:first.id,confirmation:'SUBMIT PI'}),env },maker);

  const makerCannotApprove = await handleD1OperatingModel({ request:post({action:'APPROVE_PAYMENT',paymentInstructionId:first.id,actionHash:first.content_hash,confirmation:'KONFIRMASI PAYMENT'}),env },maker);
  assert.equal(makerCannotApprove.status,403);
  const clientCannotReject = await handleD1OperatingModel({ request:post({action:'REJECT_PAYMENT',paymentInstructionId:first.id,reason:'Client tidak boleh menolak payment instruction'}),env },client);
  assert.equal(clientCannotReject.status,403);

  const rejected = await handleD1OperatingModel({ request:post({action:'REJECT_PAYMENT',paymentInstructionId:first.id,reason:'Mohon review ulang periode pembayaran dan konfirmasi'}),env },controller);
  assert.equal(rejected.status,200,await rejected.clone().text());
  DB.sqlite.prepare(`UPDATE payroll_submissions SET state='PAYMENT_INSTRUCTION_READY' WHERE id='SUB-UAT'`).run();

  const reviewedResponse = await handleD1OperatingModel({ request:post({action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:'SUB-UAT'}),env },recoveryMaker);
  assert.equal(reviewedResponse.status,201,await reviewedResponse.clone().text());
  const reviewedPayload = await reviewedResponse.json();
  assert.notEqual(reviewedPayload.paymentInstruction.id,first.id);
  assert.equal(reviewedPayload.paymentInstruction.status,'PAYMENT_INSTRUCTION_READY');
  assert.equal(reviewedPayload.paymentInstruction.creator_user_id,recoveryMaker.id);
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_instructions WHERE id=?').get(first.id).status,'REJECTED');

  const revisedId=reviewedPayload.paymentInstruction.id;
  const resubmitted = await handleD1OperatingModel({ request:post({action:'SUBMIT_PAYMENT_INSTRUCTION',paymentInstructionId:revisedId,confirmation:'SUBMIT PI'}),env },recoveryMaker);
  assert.equal(resubmitted.status,200,await resubmitted.clone().text());
  const recoveryMakerCannotApprove = await handleD1OperatingModel({ request:post({action:'APPROVE_PAYMENT',paymentInstructionId:revisedId,actionHash:first.content_hash,confirmation:'KONFIRMASI PAYMENT'}),env },recoveryMaker);
  assert.equal(recoveryMakerCannotApprove.status,403);
  const approved = await handleD1OperatingModel({ request:post({action:'APPROVE_PAYMENT',paymentInstructionId:revisedId,actionHash:first.content_hash,confirmation:'KONFIRMASI PAYMENT'}),env },controller);
  assert.equal(approved.status,200,await approved.clone().text());
});
