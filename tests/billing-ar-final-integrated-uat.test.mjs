import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as billing } from '../functions/api/billing.js';
import { createSession } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const sameOrigin={Origin:origin,'Sec-Fetch-Site':'same-origin'};

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients
      (id,org_id,code,name,billing_method,billing_rate,billing_admin_fee,billing_tax_rate,tax_status,payment_terms_days)
      VALUES('CLI-FINAL-BILL','ORG-OTSINDO','FB','PT Final Billing','FIXED',100000,0,11,'PKP',30);
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES
      ('PRJ-FINAL-A','ORG-OTSINDO','CLI-FINAL-BILL','FBA','Final Project A','seed'),
      ('PRJ-FINAL-B','ORG-OTSINDO','CLI-FINAL-BILL','FBB','Final Project B','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by) VALUES
      ('SP-FINAL-A','CLI-FINAL-BILL','PRJ-FINAL-A','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed'),
      ('SP-FINAL-B','CLI-FINAL-BILL','PRJ-FINAL-B','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif) VALUES
      ('EMP-FINAL-A','ORG-OTSINDO','CLI-FINAL-BILL','PRJ-FINAL-A','F-A-001','Final Employee A','ACTIVE'),
      ('EMP-FINAL-B','ORG-OTSINDO','CLI-FINAL-BILL','PRJ-FINAL-B','F-B-001','Final Employee B','ACTIVE');
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES
      ('SUB-FINAL-A','ORG-OTSINDO','CLI-FINAL-BILL','PRJ-FINAL-A','SP-FINAL-A','TIER_1_PAYMENT_PROCESSING','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','COMPLETED','seed'),
      ('SUB-FINAL-B','ORG-OTSINDO','CLI-FINAL-BILL','PRJ-FINAL-B','SP-FINAL-B','TIER_1_PAYMENT_PROCESSING','2026-10','2026-10','REGULAR','MASTER_CURRENT','READY','COMPLETED','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count,billing_snapshot)
      VALUES
      ('PI-FINAL-A','ORG-OTSINDO','CLI-FINAL-BILL','SUB-FINAL-A','COMPLETED',5000000,'maker','PI-FINAL-A-key','PI/FINAL/A',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1','IDR',1,
       '{"method":"FIXED","rate":100000,"adminFee":0,"taxRate":11,"taxStatus":"PKP","paymentTermsDays":30}'),
      ('PI-FINAL-B','ORG-OTSINDO','CLI-FINAL-BILL','SUB-FINAL-B','COMPLETED',6000000,'maker','PI-FINAL-B-key','PI/FINAL/B',
       'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2','IDR',1,
       '{"method":"FIXED","rate":120000,"adminFee":0,"taxRate":11,"taxStatus":"PKP","paymentTermsDays":30}');
    INSERT INTO payment_instruction_lines
      (id,payment_instruction_id,employee_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
      VALUES
      ('PIL-FINAL-A','PI-FINAL-A','EMP-FINAL-A','Final Employee A','BCA','BCA','******7890','cipher','iv','7890',
       'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',5000000),
      ('PIL-FINAL-B','PI-FINAL-B','EMP-FINAL-B','Final Employee B','BCA','BCA','******4321','cipher','iv','4321',
       'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',6000000);
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES
      ('USR-FINAL-P','ORG-OTSINDO','Final Processor','final.processor@proqpay.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
      ('USR-FINAL-C','ORG-OTSINDO','Final Controller','final.controller@proqpay.test','PAYROLL_CONTROLLER','ACTIVE','hash','salt',100000,0,1,'seed');
  `);
}

async function post(env,token,body){
  const response=await billing({request:new Request(origin+'/api/billing',{
    method:'POST',
    headers:{...sameOrigin,'Content-Type':'application/json',Cookie:`proqpay_session=${token}`},
    body:JSON.stringify(body),
  }),env});
  return {response,payload:await response.json()};
}

async function createIssuedInvoice(env,processorToken,controllerToken,paymentInstructionId,taxNo,taxDate){
  let result=await post(env,processorToken,{action:'GENERATE_INVOICE',paymentInstructionId});
  assert.equal(result.response.status,201,JSON.stringify(result.payload));
  const invoiceId=result.payload.invoice.id;

  result=await post(env,processorToken,{action:'SUBMIT_INVOICE',invoiceId});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.invoice.status,'UNDER_REVIEW');

  result=await post(env,controllerToken,{action:'APPROVE_INVOICE',invoiceId});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.invoice.status,'APPROVED');

  result=await post(env,controllerToken,{
    action:'RECORD_TAX_INVOICE',
    invoiceId,
    taxInvoiceStatus:'APPROVED',
    taxInvoiceNumber:taxNo,
    taxInvoiceDate:taxDate,
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));

  result=await post(env,controllerToken,{action:'ISSUE_INVOICE',invoiceId});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  const ar=env.DB.sqlite.prepare('SELECT * FROM ar_monitor WHERE invoice_id=?').get(invoiceId);
  assert.ok(ar,'issued invoice must materialize AR');
  return {invoiceId,ar};
}

test('Final Billing & AR UAT: completed PI -> maker/checker -> PKP tax -> issue -> AR overpayment control',async()=>{
  const DB=new D1Mock();seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-FINAL-P',env);
  const controller=await createSession(DB,'USR-FINAL-C',env);

  const first=await createIssuedInvoice(env,processor.token,controller.token,'PI-FINAL-A','010.000-26.90000001','2026-09-25');

  let result=await post(env,controller.token,{
    action:'RECORD_AR_PAYMENT',
    arId:first.ar.id,
    amount:Number(first.ar.amount)+25000,
    paidAt:'2026-09-25',
    reference:'FINAL-RECEIPT-001',
    notes:'Final regression overpayment',
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.balance,0);
  assert.equal(result.payload.status,'PAID');
  assert.equal(result.payload.unapplied,25000);

  const applied=DB.sqlite.prepare('SELECT amount FROM ar_payments WHERE ar_id=? AND reference=?').get(first.ar.id,'FINAL-RECEIPT-001');
  const unapplied=DB.sqlite.prepare("SELECT amount,status FROM unapplied_cash WHERE ar_id=? AND reference=? AND status<>'VOID'").get(first.ar.id,'FINAL-RECEIPT-001');
  assert.equal(Number(applied.amount),Number(first.ar.amount));
  assert.equal(Number(unapplied.amount),25000);
  assert.equal(unapplied.status,'OPEN');

  result=await post(env,controller.token,{
    action:'RECORD_AR_PAYMENT',
    arId:first.ar.id,
    amount:Number(first.ar.amount)+25000,
    paidAt:'2026-09-25',
    reference:'FINAL-RECEIPT-001',
    notes:'Idempotent replay',
  });
  assert.equal(result.response.status,200);
  assert.equal(result.payload.idempotentReplay,true);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM ar_payments WHERE ar_id=? AND reference=?').get(first.ar.id,'FINAL-RECEIPT-001').count,1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM unapplied_cash WHERE ar_id=? AND reference=? AND status<>'VOID'").get(first.ar.id,'FINAL-RECEIPT-001').count,1);

  const auditActions=DB.sqlite.prepare("SELECT action FROM audit_logs WHERE entity='invoice' AND entity_id=? ORDER BY timestamp").all(first.invoiceId).map((row)=>row.action);
  assert.ok(auditActions.includes('INVOICE_GENERATED'));
  assert.ok(auditActions.includes('INVOICE_SUBMITTED_FOR_REVIEW'));
  assert.ok(auditActions.includes('INVOICE_APPROVED'));
  assert.ok(auditActions.includes('TAX_INVOICE_RECORDED'));
  assert.ok(auditActions.includes('INVOICE_ISSUED'));
});

test('Final Billing & AR UAT: same-client receipt reference cannot be double-booked to another AR',async()=>{
  const DB=new D1Mock();seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-FINAL-P',env);
  const controller=await createSession(DB,'USR-FINAL-C',env);

  const first=await createIssuedInvoice(env,processor.token,controller.token,'PI-FINAL-A','010.000-26.90000011','2026-09-25');
  const second=await createIssuedInvoice(env,processor.token,controller.token,'PI-FINAL-B','010.000-26.90000012','2026-09-25');

  let result=await post(env,controller.token,{
    action:'RECORD_AR_PAYMENT',
    arId:first.ar.id,
    amount:50000,
    paidAt:'2026-09-25',
    reference:'DUP-RECEIPT-FINAL',
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));

  result=await post(env,controller.token,{
    action:'RECORD_AR_PAYMENT',
    arId:second.ar.id,
    amount:50000,
    paidAt:'2026-09-25',
    reference:'DUP-RECEIPT-FINAL',
  });
  assert.equal(result.response.status,409,JSON.stringify(result.payload));
  assert.equal(result.payload.code,'AR_REFERENCE_ALREADY_ALLOCATED');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM ar_payments WHERE ar_id=?').get(second.ar.id).count,0);

  assert.throws(
    ()=>DB.sqlite.prepare(`INSERT INTO ar_payments(id,ar_id,amount,payment_date,reference,recorded_by)
      VALUES('RACE-DUP',?,1000,'2026-09-25','DUP-RECEIPT-FINAL','race@proqpay.test')`).run(second.ar.id),
    /AR payment reference already allocated to another receivable/,
  );
});

test('Final Billing & AR UAT: dispute follow-up keeps financial balance and records workflow history',async()=>{
  const DB=new D1Mock();seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-FINAL-P',env);
  const controller=await createSession(DB,'USR-FINAL-C',env);

  const first=await createIssuedInvoice(env,processor.token,controller.token,'PI-FINAL-A','010.000-26.90000021','2026-09-25');
  const openingBalance=Number(first.ar.balance);
  const result=await post(env,controller.token,{
    action:'FOLLOW_UP_AR',
    arId:first.ar.id,
    notes:'Klien meminta klarifikasi invoice',
    nextFollowUpAt:'2026-09-30',
    disputed:true,
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.status,'DISPUTED');

  const current=DB.sqlite.prepare('SELECT status,balance,dispute_reason,next_follow_up_at FROM ar_monitor WHERE id=?').get(first.ar.id);
  assert.equal(current.status,'DISPUTED');
  assert.equal(Number(current.balance),openingBalance);
  assert.match(current.dispute_reason,/klarifikasi invoice/);
  assert.equal(current.next_follow_up_at,'2026-09-30');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM ar_follow_ups WHERE ar_id=?').get(first.ar.id).count,1);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity='ar' AND entity_id=? AND action='AR_FOLLOW_UP_RECORDED'").get(first.ar.id).count,1);
});
