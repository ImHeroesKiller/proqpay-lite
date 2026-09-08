import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as operatingModel } from '../functions/api/operating-model.js';
import { onRequest as paymentProof } from '../functions/api/payment-proof.js';
import { addBusinessDaysUtc, onRequest as billing } from '../functions/api/billing.js';
import { createSession } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';

function jsonRequest(path, body, token = '') {
  return new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
      ...(token ? { Cookie: `proqpay_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function addUser(DB, { id, email, role }) {
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE','test-hash','test-salt',100000,0,0,'seed')`).run(id, 'ORG-OTSINDO', role, email, role);
}

function seedCore(DB) {
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-BP','ORG-OTSINDO','BP','PT Business Process');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-BP','ORG-OTSINDO','CLI-BP','BP','Business Process','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-BP','CLI-BP','PRJ-BP','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
  `);
}

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

test('business process guard blocks SoD bypass, late validation, and unstable COPY_PREVIOUS', async () => {
  const DB = new D1Mock();
  seedCore(DB);
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES
      ('SUB-CTRL','ORG-OTSINDO','CLI-BP','PRJ-BP','SP-BP','TIER_2_MANAGED_PAYROLL','2026-08','2026-08','REGULAR','MASTER_CURRENT','READY','CONTROLLER_REVIEW','seed'),
      ('SUB-PREV','ORG-OTSINDO','CLI-BP','PRJ-BP','SP-BP','TIER_2_MANAGED_PAYROLL','2026-07','2026-07','REGULAR','MASTER_CURRENT','READY','DRAFT','seed');
  `);
  const processor = { id:'USR-P', email:'processor@proqpay.test', role:'PAYROLL_PROCESSOR' };
  addUser(DB, processor);
  const env = { DB, AUTH_MODE:'session', DEFAULT_ORG_ID:'ORG-OTSINDO', PI_ENCRYPTION_KEY:'uat-native-cloudflare-key-32-bytes-minimum' };
  const session = await createSession(DB, processor.id, env);

  let response = await operatingModel({ request:jsonRequest('/api/operating-model', {
    action:'TRANSITION_SUBMISSION', submissionId:'SUB-CTRL', toState:'DATA_APPROVED', reviewConfirmed:true,
  }, session.token), env });
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal((await response.json()).code, 'CONTROLLER_REVIEW_SOD');
  assert.equal(DB.sqlite.prepare("SELECT state FROM payroll_submissions WHERE id='SUB-CTRL'").get().state, 'CONTROLLER_REVIEW');

  DB.sqlite.prepare("UPDATE payroll_submissions SET state='PAYMENT_INSTRUCTION_READY' WHERE id='SUB-CTRL'").run();
  response = await operatingModel({ request:jsonRequest('/api/operating-model', {
    action:'TRANSITION_SUBMISSION', submissionId:'SUB-CTRL', toState:'PAYMENT_APPROVAL_PENDING',
  }, session.token), env });
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json()).code, 'SPECIALIZED_PAYMENT_ACTION_REQUIRED');

  DB.sqlite.prepare("UPDATE payroll_submissions SET state='COMPLETED' WHERE id='SUB-CTRL'").run();
  response = await operatingModel({ request:jsonRequest('/api/operating-model', {
    action:'CREATE_VALIDATION_BATCH', submissionId:'SUB-CTRL', issues:[],
  }, session.token), env });
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json()).code, 'VALIDATION_PHASE_LOCKED');
  assert.equal(DB.sqlite.prepare("SELECT state FROM payroll_submissions WHERE id='SUB-CTRL'").get().state, 'COMPLETED');

  response = await operatingModel({ request:jsonRequest('/api/operating-model', {
    action:'CREATE_PAY_RUN', clientId:'CLI-BP', projectId:'PRJ-BP', servicePlanId:'SP-BP', period:'2026-08',
    paymentPeriod:'2026-08', paymentDate:'2026-08-25', runType:'REGULAR', sourceMode:'COPY_PREVIOUS',
  }, session.token), env });
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json()).code, 'PREVIOUS_PAY_RUN_NOT_FINAL');
});

test('manual proof is a fallback only after gateway is no longer active', async () => {
  const DB = new D1Mock();
  seedCore(DB);
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES('SUB-PAY','ORG-OTSINDO','CLI-BP','PRJ-BP','SP-BP','TIER_2_MANAGED_PAYROLL','2026-08','2026-08','REGULAR','MASTER_CURRENT','READY','DISBURSEMENT_PROCESSING','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count)
      VALUES('PI-PAY','ORG-OTSINDO','CLI-BP','SUB-PAY','DISBURSEMENT_PROCESSING',1000000,'maker','PI-PAY-key','PI/BP','${'a'.repeat(64)}','IDR',1);
    INSERT INTO payment_gateway_transactions
      (id,org_id,client_id,payment_instruction_id,provider,provider_transaction_id,status,amount,currency,payment_method,idempotency_key,request_hash,created_by)
      VALUES('PGT-PAY','ORG-OTSINDO','CLI-BP','PI-PAY','MOCK','MOCK-TX','PROCESSING',1000000,'IDR','BANK_TRANSFER','PGT-key','${'b'.repeat(64)}','processor@proqpay.test');
  `);
  const processor = { id:'USR-PAY', email:'processor@proqpay.test', role:'PAYROLL_PROCESSOR' };
  addUser(DB, processor);
  const FILES = new R2Mock();
  const env = { DB, FILES, AUTH_MODE:'session', DEFAULT_ORG_ID:'ORG-OTSINDO' };
  const session = await createSession(DB, processor.id, env);

  const makeRequest = () => {
    const form = new FormData();
    form.set('paymentInstructionId', 'PI-PAY');
    form.set('bank', 'BCA');
    form.set('reference', 'REF-BP-1');
    form.set('transactionDate', '2026-09-08');
    form.set('amount', '1000000');
    form.set('file', new File([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34])], 'proof.pdf', { type:'application/pdf' }));
    return new Request(`${origin}/api/payment-proof`, {
      method:'POST', headers:{ Origin:origin, 'Sec-Fetch-Site':'same-origin', Cookie:`proqpay_session=${session.token}` }, body:form,
    });
  };

  let response = await paymentProof({ request:makeRequest(), env });
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json()).code, 'PAYMENT_GATEWAY_ACTIVE');
  assert.equal(FILES.objects.size, 0);

  DB.sqlite.prepare("UPDATE payment_gateway_transactions SET status='FAILED' WHERE id='PGT-PAY'").run();
  response = await paymentProof({ request:makeRequest(), env });
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(FILES.objects.size, 1);
  assert.equal(DB.sqlite.prepare("SELECT status FROM payment_instructions WHERE id='PI-PAY'").get().status, 'PROOF_UPLOADED');
  assert.equal(DB.sqlite.prepare("SELECT state FROM payroll_submissions WHERE id='SUB-PAY'").get().state, 'PROOF_UPLOADED');
});

test('billing uses canonical partial status and business-day payment terms', async () => {
  assert.equal(addBusinessDaysUtc(new Date('2026-09-04T00:00:00Z'), 1).toISOString().slice(0,10), '2026-09-07');
  assert.equal(addBusinessDaysUtc(new Date('2026-09-05T00:00:00Z'), 1).toISOString().slice(0,10), '2026-09-07');

  const DB = new D1Mock();
  seedCore(DB);
  DB.sqlite.exec(`
    INSERT INTO invoices(id,org_id,client_id,project_id,company,period,invoice_number,amount,subtotal,total_amount,status,created_by)
      VALUES('INV-BP','ORG-OTSINDO','CLI-BP','PRJ-BP','PT Business Process','2026-08','INV/BP',1000000,1000000,1000000,'ISSUED','processor');
    INSERT INTO ar_monitor(id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,type)
      VALUES('AR-BP','ORG-OTSINDO','CLI-BP','PRJ-BP','PT Business Process','INV-BP',1000000,0,1000000,'OUTSTANDING','2026-10-30','INVOICE');
  `);
  const env = { DB, DEFAULT_ORG_ID:'ORG-OTSINDO' };
  const response = await billing({ request:jsonRequest('/api/billing', {
    action:'RECORD_AR_PAYMENT', arId:'AR-BP', amount:400000, paidAt:'2026-09-08', reference:'AR-PARTIAL-1',
  }), env });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(DB.sqlite.prepare("SELECT status FROM ar_monitor WHERE id='AR-BP'").get().status, 'PARTIALLY_PAID');
  assert.equal(DB.sqlite.prepare("SELECT status FROM invoices WHERE id='INV-BP'").get().status, 'PARTIALLY_PAID');
});
