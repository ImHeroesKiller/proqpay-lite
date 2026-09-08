import assert from 'node:assert/strict';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { onRequest as hostedPayment } from '../functions/api/payment-gateway-hosted.js';
import { onRequest as gatewayWebhook } from '../functions/api/payment-gateway-webhook.js';
import { createSession } from '../functions/api/_account-auth.js';
import { hmacSha256Hex } from '../functions/api/payment-gateway-core.js';
import { sha256Hex } from '../functions/api/payment-instruction-core.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin = 'https://proqpay.test';

function operatingRequest(path, options = {}) {
  return new Request(`${origin}${path}`, {
    ...options,
    headers: { Origin:origin, 'Sec-Fetch-Site':'same-origin', 'Content-Type':'application/json', ...(options.headers || {}) },
  });
}

function postOperating(action) {
  return operatingRequest('/api/operating-model', { method:'POST', body:JSON.stringify(action) });
}

function authed(path, token, options = {}) {
  return new Request(`${origin}${path}`, {
    ...options,
    headers: {
      Origin:origin,
      'Sec-Fetch-Site':'same-origin',
      Cookie:`proqpay_session=${token}`,
      ...(options.body ? { 'Content-Type':'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
}

function seed(DB) {
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-PG','ORG-OTSINDO','PG','PT Gateway UAT');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-PG','ORG-OTSINDO','CLI-PG','PRJ-PG','Gateway Project','seed');
    INSERT INTO client_service_plans(id,client_id,tier,effective_from,created_by,status)
      VALUES('SP-PG','CLI-PG','TIER_1_PAYMENT_PROCESSING','2026-01-01','seed','ACTIVE');
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,created_by)
      VALUES('SUB-PG','ORG-OTSINDO','CLI-PG','PRJ-PG','SP-PG','TIER_1_PAYMENT_PROCESSING','2026-09','2026-09','PAYMENT_INSTRUCTION_READY','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-PG','ORG-OTSINDO','CLI-PG','PRJ-PG','PG-001','Gateway Recipient','ACTIVE');
    INSERT INTO employee_compensation(employee_id,basic_salary,payroll_source_period,imported_gross,imported_deduction,imported_net)
      VALUES('EMP-PG',5000000,'2026-09',5000000,0,5000000);
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
      VALUES('BANK-PG','EMP-PG','BCA','1234567890',1);
  `);
}

async function prepareApprovedPi(DB, env) {
  const maker = { id:'USR-PG-MAKER', email:'maker.pg@proqpay.test', role:'PAYROLL_PROCESSOR', permissions:['payment:prepare'] };
  const controller = { id:'USR-PG-CONTROLLER', email:'controller.pg@proqpay.test', role:'PAYROLL_CONTROLLER', permissions:['payment:approve'] };

  const generatedResponse = await handleD1OperatingModel({ request:postOperating({ action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:'SUB-PG' }),env },maker);
  assert.equal(generatedResponse.status,201,await generatedResponse.clone().text());
  const pi = (await generatedResponse.json()).paymentInstruction;

  const submitted = await handleD1OperatingModel({ request:postOperating({ action:'SUBMIT_PAYMENT_INSTRUCTION',paymentInstructionId:pi.id,confirmation:'SUBMIT PI' }),env },maker);
  assert.equal(submitted.status,200,await submitted.clone().text());
  const approved = await handleD1OperatingModel({ request:postOperating({ action:'APPROVE_PAYMENT',paymentInstructionId:pi.id,actionHash:pi.content_hash,confirmation:'KONFIRMASI PAYMENT' }),env },controller);
  assert.equal(approved.status,200,await approved.clone().text());

  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE','test-hash','test-salt',100000,0,?,'seed')`).run(
      maker.id,'ORG-OTSINDO','Gateway Maker',maker.email,maker.role,0
    );
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE','test-hash','test-salt',100000,0,?,'seed')`).run(
      controller.id,'ORG-OTSINDO','Gateway Controller',controller.email,controller.role,1
    );

  const makerSession = await createSession(DB,maker.id,env);
  const controllerSession = await createSession(DB,controller.id,env);
  return { pi,makerSession,controllerSession };
}

async function signedWebhook(env, payload) {
  const raw = JSON.stringify(payload);
  const signature = await hmacSha256Hex(env.PAYMENT_GATEWAY_WEBHOOK_SECRET,raw);
  return {
    raw,
    request:new Request(`${origin}/api/payment-gateway-webhook`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json','X-Payment-Signature':`sha256=${signature}` },
      body:raw,
    }),
  };
}

test('Hosted gateway E2E expires stale sessions, retries safely, resumes webhook processing, and never regresses success', async () => {
  const DB = new D1Mock();
  seed(DB);
  const env = {
    DB,
    DEFAULT_ORG_ID:'ORG-OTSINDO',
    PI_ENCRYPTION_KEY:'uat-native-cloudflare-key-32-bytes-minimum',
    PAYMENT_GATEWAY_PROVIDER:'MOCK',
    PAYMENT_GATEWAY_ALLOW_MOCK:'true',
    PAYMENT_GATEWAY_HOSTED_ENABLED:'true',
    PAYMENT_GATEWAY_MOCK_HOSTED_ORIGIN:'https://gateway.mock',
    PAYMENT_GATEWAY_WEBHOOK_SECRET:'gateway-e2e-secret',
    AUTH_MODE:'session',
  };
  const { pi,makerSession,controllerSession } = await prepareApprovedPi(DB,env);

  const firstCreate = await hostedPayment({ request:authed('/api/payment-gateway-hosted',makerSession.token,{
    method:'POST',body:JSON.stringify({ paymentInstructionId:pi.id,returnPath:'/?view=payments' }),
  }),env });
  assert.equal(firstCreate.status,201,await firstCreate.clone().text());
  const firstSession = (await firstCreate.json()).session;
  assert.equal(firstSession.status,'READY');
  assert.match(firstSession.checkout_url,/^https:\/\/gateway\.mock\/checkout/);
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_gateway_transactions WHERE id=?').get(firstSession.payment_gateway_transaction_id).status,'PENDING');
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_instructions WHERE id=?').get(pi.id).status,'DISBURSEMENT_PROCESSING');

  const controllerRead = await hostedPayment({ request:authed(`/api/payment-gateway-hosted?paymentInstructionId=${encodeURIComponent(pi.id)}`,controllerSession.token,{ method:'GET' }),env });
  assert.equal(controllerRead.status,200,await controllerRead.clone().text());
  assert.equal((await controllerRead.json()).session.checkout_url,null,'Controller must not receive bearer-like checkout URL');

  DB.sqlite.prepare(`UPDATE hosted_payment_sessions SET expires_at='2020-01-01T00:00:00.000Z' WHERE id=?`).run(firstSession.id);
  const expiredRead = await hostedPayment({ request:authed(`/api/payment-gateway-hosted?paymentInstructionId=${encodeURIComponent(pi.id)}`,makerSession.token,{ method:'GET' }),env });
  assert.equal(expiredRead.status,200,await expiredRead.clone().text());
  const expiredSession = (await expiredRead.json()).session;
  assert.equal(expiredSession.status,'EXPIRED');
  assert.equal(expiredSession.checkout_url,null);
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_gateway_transactions WHERE id=?').get(firstSession.payment_gateway_transaction_id).status,'EXPIRED');

  const retryCreate = await hostedPayment({ request:authed('/api/payment-gateway-hosted',makerSession.token,{
    method:'POST',body:JSON.stringify({ paymentInstructionId:pi.id,returnPath:'/?view=payments' }),
  }),env });
  assert.equal(retryCreate.status,201,await retryCreate.clone().text());
  const retrySession = (await retryCreate.json()).session;
  assert.notEqual(retrySession.id,firstSession.id);
  assert.equal(retrySession.status,'READY');

  const successPayload = {
    eventId:'EVT-PG-RESUME',
    transactionId:retrySession.provider_session_id,
    type:'payment.status',
    status:'paid',
    amount:Number(pi.expected_total),
    currency:'IDR',
  };
  const success = await signedWebhook(env,successPayload);
  const payloadHash = await sha256Hex(success.raw);

  // Simulate a worker crash after durable event registration but before business-state processing.
  DB.sqlite.prepare(`INSERT INTO payment_gateway_events
    (id,payment_gateway_transaction_id,provider,provider_event_id,event_type,signature_valid,payload_hash,payload_json,status)
    VALUES(?,?,?,?,?,1,?,?,'RECEIVED')`).run(
      'PGE-PRE-REGISTERED',retrySession.payment_gateway_transaction_id,'MOCK',successPayload.eventId,'payment.status',payloadHash,success.raw
    );

  const resumed = await gatewayWebhook({ request:success.request,env });
  assert.equal(resumed.status,200,await resumed.clone().text());
  assert.equal((await resumed.json()).status,'COMPLETED');
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_gateway_events WHERE id=?').get('PGE-PRE-REGISTERED').status,'PROCESSED');
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_gateway_transactions WHERE id=?').get(retrySession.payment_gateway_transaction_id).status,'SUCCEEDED');
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_instructions WHERE id=?').get(pi.id).status,'COMPLETED');
  assert.equal(DB.sqlite.prepare('SELECT state FROM payroll_submissions WHERE id=?').get('SUB-PG').state,'COMPLETED');
  assert.equal(DB.sqlite.prepare('SELECT status FROM reconciliations WHERE payment_instruction_id=?').get(pi.id).status,'MATCHED');
  const completedHosted = DB.sqlite.prepare('SELECT status,checkout_url FROM hosted_payment_sessions WHERE id=?').get(retrySession.id);
  assert.equal(completedHosted.status,'COMPLETED');
  assert.equal(completedHosted.checkout_url,null);

  const lateFailure = await signedWebhook(env,{
    eventId:'EVT-PG-LATE-FAIL',
    transactionId:retrySession.provider_session_id,
    type:'payment.status',
    status:'failed',
    amount:Number(pi.expected_total),
    currency:'IDR',
  });
  const lateResponse = await gatewayWebhook({ request:lateFailure.request,env });
  assert.equal(lateResponse.status,200,await lateResponse.clone().text());
  const lateBody = await lateResponse.json();
  assert.equal(lateBody.ignored,true);
  assert.equal(lateBody.status,'COMPLETED');
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_gateway_transactions WHERE id=?').get(retrySession.payment_gateway_transaction_id).status,'SUCCEEDED');
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_instructions WHERE id=?').get(pi.id).status,'COMPLETED');
  assert.equal(DB.sqlite.prepare(`SELECT status FROM payment_gateway_events WHERE provider='MOCK' AND provider_event_id='EVT-PG-LATE-FAIL'`).get().status,'IGNORED');

  const replayMismatch = await signedWebhook(env,{
    eventId:'EVT-PG-LATE-FAIL',
    transactionId:retrySession.provider_session_id,
    type:'payment.status',
    status:'failed',
    amount:Number(pi.expected_total) + 1,
    currency:'IDR',
  });
  const mismatchResponse = await gatewayWebhook({ request:replayMismatch.request,env });
  assert.equal(mismatchResponse.status,409,await mismatchResponse.clone().text());
  assert.equal((await mismatchResponse.json()).code,'PAYMENT_GATEWAY_EVENT_REPLAY_MISMATCH');
  assert.equal(DB.sqlite.prepare('SELECT status FROM payment_instructions WHERE id=?').get(pi.id).status,'COMPLETED');
});
