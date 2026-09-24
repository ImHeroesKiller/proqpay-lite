import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { onRequest as billing } from '../functions/api/billing.js';
import { onRequest as taxInvoiceFile } from '../functions/api/tax-invoice-file.js';
import { createSession } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');
const sameOrigin={Origin:origin,'Sec-Fetch-Site':'same-origin'};

class R2Mock {
  constructor(){this.objects=new Map();}
  async put(key,value,options={}){this.objects.set(key,{value,...options});}
  async get(key){const object=this.objects.get(key);if(!object)return null;return {body:object.value,customMetadata:object.customMetadata,writeHttpMetadata(){}};}
}

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients
      (id,org_id,code,name,billing_method,billing_rate,billing_admin_fee,billing_tax_rate,tax_status,payment_terms_days)
      VALUES('CLI-BP1','ORG-OTSINDO','BP1','PT Billing P1','FIXED',100000,0,11,'PKP',30);
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-BP1','ORG-OTSINDO','CLI-BP1','BP1','Billing P1 Project','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-BP1','CLI-BP1','PRJ-BP1','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES('SUB-BP1','ORG-OTSINDO','CLI-BP1','PRJ-BP1','SP-BP1','TIER_1_PAYMENT_PROCESSING','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','COMPLETED','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count,billing_snapshot)
      VALUES('PI-BP1','ORG-OTSINDO','CLI-BP1','SUB-BP1','COMPLETED',5000000,'maker','PI-BP1-key','PI/BP1',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','IDR',1,
        '{"method":"FIXED","rate":100000,"adminFee":0,"taxRate":11,"taxStatus":"PKP","paymentTermsDays":30}');
    INSERT INTO payment_instruction_lines
      (id,payment_instruction_id,employee_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
      VALUES('PIL-BP1','PI-BP1','EMP-BP1','Billing Employee','BCA','BCA','******7890','cipher','iv','7890',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',5000000);
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES
      ('USR-BP1-P','ORG-OTSINDO','Billing Processor','processor.bp1@proqpay.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
      ('USR-BP1-C','ORG-OTSINDO','Billing Controller','controller.bp1@proqpay.test','PAYROLL_CONTROLLER','ACTIVE','hash','salt',100000,0,1,'seed');
  `);
}

async function postBilling(env,token,body){
  const response=await billing({request:new Request(origin+'/api/billing',{
    method:'POST',
    headers:{...sameOrigin,'Content-Type':'application/json',Cookie:`proqpay_session=${token}`},
    body:JSON.stringify(body),
  }),env});
  return {response,payload:await response.json()};
}

test('Billing P1: role permissions expose billing:prepare billing:approve and ar:write',async()=>{
  const security=await read('functions/api/_security.js');
  const ui=await read('src/components/BillingWorkspace.tsx');
  assert.match(security,/PAYROLL_PROCESSOR:[^\n]*'billing:prepare'/);
  assert.match(security,/PAYROLL_CONTROLLER:[^\n]*'billing:approve'[^\n]*'ar:write'/);
  assert.match(ui,/permissions\.includes\("billing:prepare"\)/);
  assert.match(ui,/permissions\.includes\("billing:approve"\)/);
  assert.match(ui,/permissions\.includes\("ar:write"\)/);
});

test('Billing P1: impossible calendar dates are rejected for tax, AR payment and follow-up',async()=>{
  const DB=new D1Mock();seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const controllerSession=await createSession(DB,'USR-BP1-C',env);
  DB.sqlite.exec(`
    INSERT INTO invoices
      (id,org_id,client_id,project_id,payment_instruction_id,company,period,invoice_number,amount,subtotal,tax_rate,tax_amount,total_amount,status,items,tax_invoice_status,created_by)
      VALUES('INV-BP1','ORG-OTSINDO','CLI-BP1','PRJ-BP1','PI-BP1','PT Billing P1','2026-09','INV/BP1',100000,100000,11,11000,111000,'APPROVED','[]','PENDING','processor.bp1@proqpay.test');
    INSERT INTO ar_monitor
      (id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,days_overdue,type)
      VALUES('AR-BP1','ORG-OTSINDO','CLI-BP1','PRJ-BP1','PT Billing P1','INV-BP1',111000,0,111000,'OUTSTANDING','2026-10-31',0,'INVOICE');
  `);
  let result=await postBilling(env,controllerSession.token,{action:'RECORD_TAX_INVOICE',invoiceId:'INV-BP1',taxInvoiceStatus:'APPROVED',taxInvoiceNumber:'010.000-26.00000001',taxInvoiceDate:'2026-02-30'});
  assert.equal(result.response.status,422);
  assert.equal(result.payload.code,'TAX_INVOICE_DATE_INVALID');

  result=await postBilling(env,controllerSession.token,{action:'RECORD_AR_PAYMENT',arId:'AR-BP1',amount:1000,paidAt:'2026-02-30',reference:'BAD-DATE'});
  assert.equal(result.response.status,422);
  assert.equal(result.payload.code,'AR_PAYMENT_DATE_INVALID');

  result=await postBilling(env,controllerSession.token,{action:'FOLLOW_UP_AR',arId:'AR-BP1',notes:'Follow up',nextFollowUpAt:'2026-02-30'});
  assert.equal(result.response.status,422);
  assert.equal(result.payload.code,'AR_FOLLOW_UP_DATE_INVALID');
});

test('Billing P1: tax invoice upload validates magic bytes and stores SHA-256 evidence metadata',async()=>{
  const DB=new D1Mock();seed(DB);
  DB.sqlite.exec(`
    INSERT INTO invoices
      (id,org_id,client_id,project_id,payment_instruction_id,company,period,invoice_number,amount,subtotal,tax_rate,tax_amount,total_amount,status,items,tax_invoice_status,created_by)
      VALUES('INV-FILE','ORG-OTSINDO','CLI-BP1','PRJ-BP1','PI-BP1','PT Billing P1','2026-09','INV/FILE',100000,100000,11,11000,111000,'APPROVED','[]','PENDING','processor.bp1@proqpay.test');
  `);
  const env={DB,FILES:new R2Mock(),AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const controllerSession=await createSession(DB,'USR-BP1-C',env);

  const bad=new FormData();
  bad.set('invoiceId','INV-FILE');
  bad.set('file',new File([new TextEncoder().encode('not a pdf')],'fake.pdf',{type:'application/pdf'}));
  let response=await taxInvoiceFile({request:new Request(origin+'/api/tax-invoice-file',{method:'POST',headers:{...sameOrigin,Cookie:`proqpay_session=${controllerSession.token}`},body:bad}),env});
  assert.equal(response.status,422);
  let payload=await response.json();
  assert.equal(payload.code,'TAX_INVOICE_FILE_CONTENT_INVALID');

  const valid=new FormData();
  valid.set('invoiceId','INV-FILE');
  valid.set('file',new File([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34])],'tax.pdf',{type:'application/pdf'}));
  response=await taxInvoiceFile({request:new Request(origin+'/api/tax-invoice-file',{method:'POST',headers:{...sameOrigin,Cookie:`proqpay_session=${controllerSession.token}`},body:valid}),env});
  assert.equal(response.status,201,await response.clone().text());
  payload=await response.json();
  assert.match(payload.fileSha256,/^[a-f0-9]{64}$/);
  assert.equal(payload.mimeType,'application/pdf');
  const stored=[...env.FILES.objects.values()][0];
  assert.equal(stored.customMetadata.fileSha256,payload.fileSha256);
  const audit=DB.sqlite.prepare("SELECT detail FROM audit_logs WHERE entity='tax_invoice_file' AND entity_id='INV-FILE' ORDER BY timestamp DESC LIMIT 1").get();
  assert.equal(JSON.parse(audit.detail).fileSha256,payload.fileSha256);
});

test('Billing P1: invoice and AR lifecycle writes explicit financial audit events',async()=>{
  const DB=new D1Mock();seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processorSession=await createSession(DB,'USR-BP1-P',env);
  const controllerSession=await createSession(DB,'USR-BP1-C',env);

  let result=await postBilling(env,processorSession.token,{action:'GENERATE_INVOICE',paymentInstructionId:'PI-BP1',reimbursement:0,discount:0});
  assert.equal(result.response.status,201,JSON.stringify(result.payload));
  const invoiceId=result.payload.invoice.id;
  result=await postBilling(env,processorSession.token,{action:'SUBMIT_INVOICE',invoiceId});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  result=await postBilling(env,controllerSession.token,{action:'APPROVE_INVOICE',invoiceId});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  result=await postBilling(env,controllerSession.token,{action:'RECORD_TAX_INVOICE',invoiceId,taxInvoiceStatus:'APPROVED',taxInvoiceNumber:'010.000-26.00000002',taxInvoiceDate:'2026-09-25'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));

  const actions=DB.sqlite.prepare("SELECT action FROM audit_logs WHERE entity='invoice' AND entity_id=? ORDER BY timestamp").all(invoiceId).map((row)=>row.action);
  assert.ok(actions.includes('INVOICE_GENERATED'));
  assert.ok(actions.includes('INVOICE_SUBMITTED_FOR_REVIEW'));
  assert.ok(actions.includes('INVOICE_APPROVED'));
  assert.ok(actions.includes('TAX_INVOICE_RECORDED'));

  DB.sqlite.exec(`
    INSERT INTO ar_monitor
      (id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,days_overdue,type)
      VALUES('AR-AUDIT','ORG-OTSINDO','CLI-BP1','PRJ-BP1','PT Billing P1','${invoiceId}',111000,0,111000,'OUTSTANDING','2026-10-31',0,'INVOICE');
  `);
  result=await postBilling(env,controllerSession.token,{action:'RECORD_AR_PAYMENT',arId:'AR-AUDIT',amount:11000,paidAt:'2026-09-25',reference:'AR-AUDIT-1'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  result=await postBilling(env,controllerSession.token,{action:'FOLLOW_UP_AR',arId:'AR-AUDIT',notes:'Reminder dikirim',nextFollowUpAt:'2026-09-30'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  const arActions=DB.sqlite.prepare("SELECT action FROM audit_logs WHERE entity='ar' AND entity_id='AR-AUDIT' ORDER BY timestamp").all().map((row)=>row.action);
  assert.ok(arActions.includes('AR_PAYMENT_RECORDED'));
  assert.ok(arActions.includes('AR_FOLLOW_UP_RECORDED'));
});

test('Billing P1: operational errors no longer expose D1 or R2 implementation terms',async()=>{
  const billingSource=await read('functions/api/billing.js');
  const taxSource=await read('functions/api/tax-invoice-file.js');
  assert.doesNotMatch(billingSource,/Cloudflare D1 belum terhubung/);
  assert.doesNotMatch(taxSource,/Cloudflare D1 belum terhubung/);
  assert.doesNotMatch(taxSource,/tidak ditemukan di R2/);
});
