import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { onRequest as billing } from '../functions/api/billing.js';
import { onRequest as paymentProof } from '../functions/api/payment-proof.js';
import { createSession } from '../functions/api/_account-auth.js';
import { derivePayrollBusinessStage } from '../src/lib/payroll-business-stage-core.js';
import { derivePayrollNextAction } from '../src/lib/payroll-next-action-core.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const processor={id:'USR-AUD-P',email:'processor.audit@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:['payment:prepare']};
const controller={id:'USR-AUD-C',email:'controller.audit@proqpay.test',role:'PAYROLL_CONTROLLER',permissions:['payment:approve']};
const client={id:'USR-AUD-CL',email:'client.audit@proqpay.test',role:'CLIENT_USER',permissions:['read'],clientIds:['CLI-AUD'],projectIds:['PRJ-AUD']};

class R2Mock {
  constructor(){this.objects=new Map();}
  async put(key,value,options={}){this.objects.set(key,{value,...options});}
  async get(key){
    const object=this.objects.get(key);
    if(!object) return null;
    return {
      body:object.value,
      customMetadata:object.customMetadata,
      writeHttpMetadata(headers){if(object.httpMetadata?.contentType) headers.set('Content-Type',object.httpMetadata.contentType);},
    };
  }
  async delete(key){this.objects.delete(key);}
}

function apiRequest(body,cookie=''){
  return new Request(origin+'/api/operating-model',{
    method:'POST',
    headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',...(cookie?{Cookie:`proqpay_session=${cookie}`}:{})},
    body:JSON.stringify(body),
  });
}

async function operating(DB,env,actor,body){
  const response=await handleD1OperatingModel({request:apiRequest(body),env},actor);
  return {response,payload:await response.json()};
}

async function billingCall(env,token,body){
  const response=await billing({request:new Request(origin+'/api/billing',{
    method:'POST',
    headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',Cookie:`proqpay_session=${token}`},
    body:JSON.stringify(body),
  }),env});
  return {response,payload:await response.json()};
}

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients
      (id,org_id,code,name,billing_method,billing_rate,billing_admin_fee,billing_tax_rate,tax_status,payment_terms_days)
      VALUES('CLI-AUD','ORG-OTSINDO','AUD','PT Audit UAT','FIXED',1000000,0,0,'NON_PKP',30);
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-AUD','ORG-OTSINDO','CLI-AUD','AUD','Audit Project','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-AUD','CLI-AUD','PRJ-AUD','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-AUD','ORG-OTSINDO','CLI-AUD','PRJ-AUD','AUD-001','Audit Employee','ACTIVE');
    INSERT INTO employee_compensation(employee_id,basic_salary)
      VALUES('EMP-AUD',5000000);
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
      VALUES('BANK-AUD','EMP-AUD','BCA','1234567890',1);
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES
      ('USR-AUD-P','ORG-OTSINDO','Audit Processor','processor.audit@proqpay.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
      ('USR-AUD-C','ORG-OTSINDO','Audit Controller','controller.audit@proqpay.test','PAYROLL_CONTROLLER','ACTIVE','hash','salt',100000,0,1,'seed');
  `);
}

test('audit: reconciliation cannot be invoked before the payment reaches reconciliation stage',async()=>{
  const DB=new D1Mock(); seed(DB);
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES('SUB-EARLY','ORG-OTSINDO','CLI-AUD','PRJ-AUD','SP-AUD','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','PAYMENT_APPROVAL_PENDING','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count)
      VALUES('PI-EARLY','ORG-OTSINDO','CLI-AUD','SUB-EARLY','PAYMENT_APPROVAL_PENDING',5000000,'USR-AUD-P','PI-EARLY-key','PI/EARLY','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','IDR',1);
    INSERT INTO payment_instruction_lines
      (id,payment_instruction_id,employee_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
      VALUES('PIL-EARLY','PI-EARLY','EMP-AUD','Audit Employee','BCA','BCA','******7890','cipher','iv','7890','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',5000000);
  `);
  const env={DB,DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const result=await operating(DB,env,controller,{action:'RECONCILE_PAYMENT',paymentInstructionId:'PI-EARLY'});
  assert.equal(result.response.status,409,JSON.stringify(result.payload));
  assert.equal(result.payload.code,'RECONCILIATION_STATE_REQUIRED');
  assert.equal(DB.sqlite.prepare("SELECT status FROM payment_instructions WHERE id='PI-EARLY'").get().status,'PAYMENT_APPROVAL_PENDING');
  assert.equal(DB.sqlite.prepare("SELECT state FROM payroll_submissions WHERE id='SUB-EARLY'").get().state,'PAYMENT_APPROVAL_PENDING');
});

test('audit: Controller cannot execute Processor-owned legacy submission or validation creation',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,DEFAULT_ORG_ID:'ORG-OTSINDO'};
  let result=await operating(DB,env,controller,{
    action:'CREATE_SUBMISSION',clientId:'CLI-AUD',servicePlanId:'SP-AUD',period:'2026-09',
  });
  assert.equal(result.response.status,403,JSON.stringify(result.payload));

  DB.sqlite.exec(`
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES('SUB-VALIDATE','ORG-OTSINDO','CLI-AUD','PRJ-AUD','SP-AUD','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','AI_VALIDATING','seed');
  `);
  result=await operating(DB,env,controller,{
    action:'CREATE_VALIDATION_BATCH',submissionId:'SUB-VALIDATE',issues:[],
  });
  assert.equal(result.response.status,403,JSON.stringify(result.payload));
});

test('UAT E2E: Processor → Controller → Client → PI → payment → billing → Close',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={
    DB,
    FILES:new R2Mock(),
    AUTH_MODE:'session',
    DEFAULT_ORG_ID:'ORG-OTSINDO',
    PI_ENCRYPTION_KEY:'full-audit-uat-encryption-key-32-bytes-minimum',
  };
  const processorSession=await createSession(DB,processor.id,env);
  const controllerSession=await createSession(DB,controller.id,env);

  let result=await operating(DB,env,processor,{
    action:'CREATE_PAY_RUN',clientId:'CLI-AUD',projectId:'PRJ-AUD',servicePlanId:'SP-AUD',
    period:'2026-09',paymentPeriod:'2026-09',paymentDate:'2026-09-25',runType:'REGULAR',sourceMode:'MASTER_CURRENT',
  });
  assert.equal(result.response.status,201,JSON.stringify(result.payload));
  const submissionId=result.payload.submission.id;

  result=await operating(DB,env,processor,{action:'FINALIZE_PAY_RUN_INPUT',submissionId,confirmation:'DATA PAYROLL FINAL'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));

  result=await operating(DB,env,processor,{action:'ADVANCE_PAY_RUN',submissionId,command:'VALIDATE',reviewConfirmed:true});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.submission.state,'VALIDATED');

  result=await operating(DB,env,processor,{action:'ADVANCE_PAY_RUN',submissionId,command:'FINALIZE_PAYROLL',reviewConfirmed:true,reviewNote:'Processor UAT review complete'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.submission.state,'CONTROLLER_REVIEW');

  result=await operating(DB,env,controller,{action:'TRANSITION_SUBMISSION',submissionId,toState:'CLIENT_APPROVAL_PENDING',reviewConfirmed:true,reviewNote:'Controller UAT approval complete'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.submission.state,'CLIENT_APPROVAL_PENDING');

  result=await operating(DB,env,client,{action:'CLIENT_APPROVE_PAYROLL',submissionId,reviewConfirmed:true,confirmation:'SETUJUI PAYROLL',reviewNote:'Client UAT sign-off'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.submission.state,'CLIENT_APPROVED');

  result=await operating(DB,env,processor,{action:'GENERATE_PAYMENT_INSTRUCTION',submissionId});
  assert.equal(result.response.status,201,JSON.stringify(result.payload));
  const pi=result.payload.paymentInstruction;

  result=await operating(DB,env,processor,{action:'SUBMIT_PAYMENT_INSTRUCTION',paymentInstructionId:pi.id,confirmation:'SUBMIT PI'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));

  result=await operating(DB,env,controller,{action:'APPROVE_PAYMENT',paymentInstructionId:pi.id,actionHash:pi.content_hash,confirmation:'KONFIRMASI PAYMENT'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));

  const form=new FormData();
  form.set('paymentInstructionId',pi.id);
  form.set('bank','BCA');
  form.set('reference','AUD-UAT-202609');
  form.set('transactionDate','2026-09-25');
  form.set('amount',String(pi.expected_total));
  form.set('file',new File([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34])],'audit-proof.pdf',{type:'application/pdf'}));
  const proofResponse=await paymentProof({request:new Request(origin+'/api/payment-proof',{
    method:'POST',
    headers:{Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:`proqpay_session=${processorSession.token}`},
    body:form,
  }),env});
  assert.equal(proofResponse.status,201,await proofResponse.clone().text());

  result=await operating(DB,env,controller,{action:'RECONCILE_PAYMENT',paymentInstructionId:pi.id});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.reconciliation.status,'MATCHED');
  assert.equal(DB.sqlite.prepare('SELECT state FROM payroll_submissions WHERE id=?').get(submissionId).state,'COMPLETED');

  let invoiceResult=await billingCall(env,processorSession.token,{action:'GENERATE_INVOICE',paymentInstructionId:pi.id});
  assert.equal(invoiceResult.response.status,201,JSON.stringify(invoiceResult.payload));
  const invoiceId=invoiceResult.payload.invoice.id;

  invoiceResult=await billingCall(env,processorSession.token,{action:'SUBMIT_INVOICE',invoiceId});
  assert.equal(invoiceResult.response.status,200,JSON.stringify(invoiceResult.payload));
  assert.equal(invoiceResult.payload.invoice.status,'UNDER_REVIEW');

  invoiceResult=await billingCall(env,controllerSession.token,{action:'APPROVE_INVOICE',invoiceId});
  assert.equal(invoiceResult.response.status,200,JSON.stringify(invoiceResult.payload));
  assert.equal(invoiceResult.payload.invoice.status,'APPROVED');

  invoiceResult=await billingCall(env,controllerSession.token,{action:'ISSUE_INVOICE',invoiceId});
  assert.equal(invoiceResult.response.status,200,JSON.stringify(invoiceResult.payload));

  const beforeClose=derivePayrollNextAction({
    role:'PAYROLL_CONTROLLER',
    state:'COMPLETED',
    reconciliationStatus:'MATCHED',
    paymentInstructionStatus:'COMPLETED',
    invoiceStatus:'ISSUED',
    periodStatus:'OPEN',
  });
  assert.equal(beforeClose.code,'CLOSE_PAY_RUN');

  result=await operating(DB,env,controller,{action:'CLOSE_PAY_RUN',submissionId,confirmation:'TUTUP PERIODE'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.submission.period_status,'CLOSED');

  const stage=derivePayrollBusinessStage({
    state:'COMPLETED',
    reconciliationStatus:'MATCHED',
    paymentInstructionStatus:'COMPLETED',
    invoiceStatus:'ISSUED',
    arStatus:'OUTSTANDING',
    periodStatus:'CLOSED',
  });
  assert.equal(stage.isTerminal,true);
  assert.equal(stage.status,'COMPLETED');

  const ar=DB.sqlite.prepare('SELECT * FROM ar_monitor WHERE invoice_id=?').get(invoiceId);
  assert.equal(ar.status,'OUTSTANDING','AR must remain collectible after payroll period close');
  assert.ok(Number(ar.balance)>0);

  const locked=await operating(DB,env,processor,{
    action:'UPDATE_PAY_RUN_LINE',submissionId,employeeId:'EMP-AUD',
    grossAmount:5000000,deductionAmount:0,netAmount:5000000,included:true,
  });
  assert.equal(locked.response.status,409,'closed payroll snapshot must remain immutable');
});

test('UI audit: intake notes, client close context, and infrastructure health visibility follow rollout rules',async()=>{
  const intake=await readFile(new URL('../src/app/data-intake/page.tsx',import.meta.url),'utf8');
  const clientHome=await readFile(new URL('../src/components/ClientHome.tsx',import.meta.url),'utf8');
  const page=await readFile(new URL('../src/app/page.tsx',import.meta.url),'utf8');

  assert.match(intake,/if \(\["TRANSFERRED", "OTHER"\]\.includes\(value\.resolution\)\) \{\s*return Boolean\(value\.note\?\.trim\(\)\);/s);
  assert.match(clientHome,/reconciliationStatus:row\.reconciliation_status/);
  assert.match(clientHome,/periodStatus:row\.period_status/);
  assert.match(page,/actor\.role === 'SUPER_ADMIN' \? <SystemHealthBubble \/> : null/);
});
