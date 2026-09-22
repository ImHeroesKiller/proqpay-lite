import assert from 'node:assert/strict';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { onRequest as billing } from '../functions/api/billing.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const post=(body)=>new Request(`${origin}/api/operating-model`,{
  method:'POST',
  headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},
  body:JSON.stringify(body),
});
const billingPost=(body)=>new Request(`${origin}/api/billing`,{
  method:'POST',
  headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},
  body:JSON.stringify(body),
});

function seedCore(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name,billing_method,billing_rate,billing_admin_fee,billing_tax_rate,tax_status,payment_terms_days)
      VALUES('CLI-CRIT','ORG-OTSINDO','CRIT','PT Critical','PERCENTAGE_OF_PAYROLL',3,0,11,'PKP',30);
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-CRIT','ORG-OTSINDO','CLI-CRIT','CRIT','Critical Project','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-CRIT','CLI-CRIT','PRJ-CRIT','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
  `);
}

test('client exception correction is scoped, resumable, and returns Pay Run to CLIENT_RESUBMITTED', async()=>{
  const DB=new D1Mock(); seedCore(DB);
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,input_status,created_by)
      VALUES('SUB-EX','ORG-OTSINDO','CLI-CRIT','PRJ-CRIT','SP-CRIT','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','EXCEPTION_FOUND','READY','seed');
    INSERT INTO payroll_exceptions(id,submission_id,category,severity,status,reason)
      VALUES('EX-1','SUB-EX','BANK','CRITICAL','OPEN','Rekening perlu dikoreksi');
  `);
  const processor={id:'USR-P',email:'processor@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:[]};
  const client={id:'USR-C',email:'client@proqpay.test',role:'CLIENT_USER',permissions:[],clientIds:['CLI-CRIT'],projectIds:['PRJ-CRIT']};
  const env={DB,DEFAULT_ORG_ID:'ORG-OTSINDO'};

  let response=await handleD1OperatingModel({request:post({action:'REQUEST_CLIENT_ACTION',exceptionId:'EX-1',message:'Perbaiki rekening lalu konfirmasi.'}),env},processor);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(DB.sqlite.prepare("SELECT state FROM payroll_submissions WHERE id='SUB-EX'").get().state,'CLIENT_ACTION_REQUIRED');
  assert.equal(DB.sqlite.prepare("SELECT status FROM payroll_exceptions WHERE id='EX-1'").get().status,'CLIENT_ACTION_REQUIRED');

  response=await handleD1OperatingModel({request:post({action:'RESOLVE_EXCEPTION',exceptionId:'EX-1',status:'ACCEPTED',resolutionNote:'Sudah diperbaiki'}),env},client);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(DB.sqlite.prepare("SELECT state FROM payroll_submissions WHERE id='SUB-EX'").get().state,'CLIENT_RESUBMITTED');
  assert.equal(DB.sqlite.prepare("SELECT status FROM payroll_exceptions WHERE id='EX-1'").get().status,'ACCEPTED');
});

test('new PI freezes billing terms so later client profile changes cannot alter invoice amount', async()=>{
  const DB=new D1Mock(); seedCore(DB);
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,input_status,created_by)
      VALUES('SUB-BILL','ORG-OTSINDO','CLI-CRIT','PRJ-CRIT','SP-CRIT','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','PAYMENT_INSTRUCTION_READY','READY','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-BILL','ORG-OTSINDO','CLI-CRIT','PRJ-CRIT','E-1','Ani','ACTIVE');
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
      VALUES('BANK-BILL','EMP-BILL','BCA','1234567890',1);
    INSERT INTO payroll_run_lines(id,submission_id,employee_id,employee_code,employee_name,bank_name,account_last4,gross_amount,deduction_amount,net_amount,components,source,included)
      VALUES('LINE-BILL','SUB-BILL','EMP-BILL','E-1','Ani','BCA','7890',10000000,0,10000000,'{}','MASTER_CURRENT',1);
  `);
  const maker={id:'USR-P',email:'processor@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:['payment:prepare']};
  const env={DB,DEFAULT_ORG_ID:'ORG-OTSINDO',PI_ENCRYPTION_KEY:'uat-native-cloudflare-key-32-bytes-minimum'};

  const generated=await handleD1OperatingModel({request:post({action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:'SUB-BILL'}),env},maker);
  assert.equal(generated.status,201,await generated.clone().text());
  const pi=(await generated.json()).paymentInstruction;
  const snapshot=JSON.parse(pi.billing_snapshot);
  assert.equal(snapshot.method,'PERCENTAGE_OF_PAYROLL');
  assert.equal(snapshot.rate,3);
  assert.equal(snapshot.taxRate,11);

  DB.sqlite.prepare("UPDATE payment_instructions SET status='COMPLETED' WHERE id=?").run(pi.id);
  DB.sqlite.prepare("UPDATE clients SET billing_rate=9,billing_tax_rate=12 WHERE id='CLI-CRIT'").run();

  const invoiceResponse=await billing({request:billingPost({action:'GENERATE_INVOICE',paymentInstructionId:pi.id,reimbursement:0,discount:0}),env});
  assert.equal(invoiceResponse.status,201,await invoiceResponse.clone().text());
  const invoice=(await invoiceResponse.json()).invoice;
  assert.equal(invoice.subtotal,300000);
  assert.equal(invoice.tax_rate,11);
  assert.equal(invoice.tax_amount,33000);
  assert.equal(invoice.total_amount,333000);
  assert.equal(JSON.parse(invoice.billing_snapshot).rate,3);
});

test('blocked Pay Run UI delegates EXCEPTION_FOUND routing to the Next Action Engine', async()=>{
  const fs=await import('node:fs/promises');
  const source=await fs.readFile(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
  const engine=await fs.readFile(new URL('../src/lib/payroll-next-action-core.js',import.meta.url),'utf8');
  assert.match(source,/derivePayrollNextAction/);
  assert.match(source,/Buka Exception Center/);
  assert.doesNotMatch(source,/function nextFor\(/);
  assert.match(engine,/state === 'EXCEPTION_FOUND'/);
  assert.match(engine,/RESOLVE_PAYROLL_ISSUES/);
});


test('reconciliation remains visible as unfinished work until MATCHED or COMPLETED', async()=>{
  const fs=await import('node:fs/promises');
  const tower=await fs.readFile(new URL('../src/components/PayrollControlTower.tsx',import.meta.url),'utf8');
  const payments=await fs.readFile(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(tower,/DONE_STATES = new Set\(\[[^\]]*'RECONCILIATION'/);
  assert.match(payments,/\['PROOF_UPLOADED','RECONCILIATION'\]\.includes\(r\.status\)/);
});
