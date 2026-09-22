import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { onRequest as operatingModel } from '../functions/api/operating-model.js';
import { acquireExecutionLease, releaseExecutionLease } from '../functions/api/payment-gateway.js';
import { createSession } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const jsonRequest=(body,token='')=>new Request(origin+'/api/operating-model',{
  method:'POST',
  headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',...(token?{Cookie:`proqpay_session=${token}`}:{})},
  body:JSON.stringify(body),
});

function seedPayroll(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-CRIT','ORG-OTSINDO','CRIT','PT Critical Flow');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-CRIT','ORG-OTSINDO','CLI-CRIT','CRIT','Critical Project','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-CRIT','CLI-CRIT','PRJ-CRIT','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-CRIT','ORG-OTSINDO','CLI-CRIT','PRJ-CRIT','CRIT-001','Critical Employee','ACTIVE');
    INSERT INTO employee_compensation(employee_id,basic_salary)
      VALUES('EMP-CRIT',5000000);
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
      VALUES('BANK-CRIT','EMP-CRIT','BCA','1234567890',1);
  `);
}

async function direct(DB,actor,body){
  const response=await handleD1OperatingModel({
    request:jsonRequest(body),
    env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO',PI_ENCRYPTION_KEY:'critical-test-key-32-bytes-minimum-123'},
  },actor);
  return {response,payload:await response.json()};
}

test('Processor finalization stops at Controller review before PI creation',async()=>{
  const DB=new D1Mock(); seedPayroll(DB);
  const processor={id:'USR-P',email:'processor@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:['payment:prepare']};
  const controller={id:'USR-C',email:'controller@proqpay.test',role:'PAYROLL_CONTROLLER',permissions:['payment:approve']};

  const created=await direct(DB,processor,{action:'CREATE_PAY_RUN',clientId:'CLI-CRIT',projectId:'PRJ-CRIT',servicePlanId:'SP-CRIT',period:'2026-09',paymentPeriod:'2026-09',paymentDate:'2026-09-25',runType:'REGULAR',sourceMode:'MASTER_CURRENT'});
  assert.equal(created.response.status,201,JSON.stringify(created.payload));
  const id=created.payload.submission.id;
  assert.equal((await direct(DB,processor,{action:'FINALIZE_PAY_RUN_INPUT',submissionId:id,confirmation:'DATA PAYROLL FINAL'})).response.status,200);
  assert.equal((await direct(DB,processor,{action:'ADVANCE_PAY_RUN',submissionId:id,command:'VALIDATE',reviewConfirmed:true})).payload.submission.state,'VALIDATED');

  const finalized=await direct(DB,processor,{action:'ADVANCE_PAY_RUN',submissionId:id,command:'FINALIZE_PAYROLL',reviewConfirmed:true,reviewNote:'Processor control complete'});
  assert.equal(finalized.response.status,200,JSON.stringify(finalized.payload));
  assert.equal(finalized.payload.submission.state,'CONTROLLER_REVIEW');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM payment_instructions WHERE submission_id=?').get(id).count,0);

  const sameReviewerAdmin={id:'USR-SA',email:processor.email,role:'SUPER_ADMIN',permissions:['payment:prepare','payment:approve']};
  const sod=await direct(DB,sameReviewerAdmin,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'CLIENT_APPROVAL_PENDING',reviewConfirmed:true,reviewNote:'Attempted self approval'});
  assert.equal(sod.response.status,409);
  assert.equal(sod.payload.code,'PAYROLL_REVIEW_SOD');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM payment_instructions WHERE submission_id=?').get(id).count,0);

  const controllerApproved=await direct(DB,controller,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'CLIENT_APPROVAL_PENDING',reviewConfirmed:true,reviewNote:'Controller verified payroll and beneficiary controls'});
  assert.equal(controllerApproved.response.status,200,JSON.stringify(controllerApproved.payload));
  assert.equal(controllerApproved.payload.submission.state,'CLIENT_APPROVAL_PENDING');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM payment_instructions WHERE submission_id=?').get(id).count,0);

  const client={id:'USR-CL',email:'client@proqpay.test',role:'CLIENT_USER',permissions:['read'],clientIds:['CLI-CRIT'],projectIds:['PRJ-CRIT']};
  const clientApproved=await direct(DB,client,{action:'CLIENT_APPROVE_PAYROLL',submissionId:id,reviewConfirmed:true,reviewNote:'Client sign-off complete',confirmation:'SETUJUI PAYROLL'});
  assert.equal(clientApproved.response.status,200,JSON.stringify(clientApproved.payload));
  assert.equal(clientApproved.payload.submission.state,'CLIENT_APPROVED');

  const approved=await direct(DB,processor,{action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:id});
  assert.equal(approved.response.status,201,JSON.stringify(approved.payload));
  assert.equal(approved.payload.paymentInstruction.status,'PAYMENT_INSTRUCTION_READY');
  assert.equal(DB.sqlite.prepare('SELECT state FROM payroll_submissions WHERE id=?').get(id).state,'PAYMENT_INSTRUCTION_READY');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM payment_instructions WHERE submission_id=? AND status<>'REJECTED'").get(id).count,1);
});

test('Successful gateway settlement can reconcile without a manual proof',async()=>{
  const DB=new D1Mock(); seedPayroll(DB);
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES('SUB-GW','ORG-OTSINDO','CLI-CRIT','PRJ-CRIT','SP-CRIT','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','RECONCILIATION','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count)
      VALUES('PI-GW','ORG-OTSINDO','CLI-CRIT','SUB-GW','RECONCILIATION',5000000,'maker','PI-GW-key','PI/GW','${'a'.repeat(64)}','IDR',1);
    INSERT INTO payment_instruction_lines
      (id,payment_instruction_id,employee_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
      VALUES('PIL-GW','PI-GW','EMP-CRIT','Critical Employee','BCA','BCA','******7890','cipher','iv','7890','${'b'.repeat(64)}',5000000);
    INSERT INTO payment_gateway_transactions
      (id,org_id,client_id,payment_instruction_id,provider,provider_transaction_id,status,amount,currency,payment_method,idempotency_key,request_hash,created_by,paid_at)
      VALUES('PGT-GW','ORG-OTSINDO','CLI-CRIT','PI-GW','E2PAY','E2-TX','SUCCEEDED',5000000,'IDR','DISBURSEMENT','PGT-GW-key','${'c'.repeat(64)}','processor@proqpay.test','2026-09-22T09:00:00.000Z');
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES('USR-REC','ORG-OTSINDO','Reconciliation Processor','processor@proqpay.test','PAYROLL_PROCESSOR','ACTIVE','test-hash','test-salt',100000,0,0,'seed');
  `);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const session=await createSession(DB,'USR-REC',env);
  const response=await operatingModel({request:jsonRequest({action:'RECONCILE_PAYMENT',paymentInstructionId:'PI-GW'},session.token),env});
  assert.equal(response.status,200,await response.clone().text());
  const body=await response.json();
  assert.equal(body.reconciliation.status,'MATCHED');
  assert.equal(body.reconciliation.proof_total,5000000);
  assert.equal(body.reconciliation.difference,0);
  assert.equal(DB.sqlite.prepare("SELECT status FROM payment_instructions WHERE id='PI-GW'").get().status,'COMPLETED');
  assert.equal(DB.sqlite.prepare("SELECT state FROM payroll_submissions WHERE id='SUB-GW'").get().state,'COMPLETED');
});

test('inactive HRIS source is fail-closed in API and absent from pay run wizard',async()=>{
  const DB=new D1Mock(); seedPayroll(DB);
  const processor={id:'USR-P',email:'processor@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:[]};
  const result=await direct(DB,processor,{action:'CREATE_PAY_RUN',clientId:'CLI-CRIT',projectId:'PRJ-CRIT',servicePlanId:'SP-CRIT',period:'2026-09',paymentPeriod:'2026-09',paymentDate:'2026-09-25',runType:'REGULAR',sourceMode:'HRIS'});
  assert.equal(result.response.status,422);
  assert.match(result.payload.error,/Integrasi HRIS belum aktif/);

  const ui=await readFile(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/<option value="HRIS">/);
  assert.match(ui,/\['PROOF_UPLOADED','RECONCILIATION'\]\.includes\(r\.status\)/);
});


test('gateway execution lease blocks concurrent financial attempts and can be released',async()=>{
  const DB=new D1Mock(); seedPayroll(DB);
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES('SUB-LOCK','ORG-OTSINDO','CLI-CRIT','PRJ-CRIT','SP-CRIT','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','APPROVED_FOR_PAYMENT','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count)
      VALUES('PI-LOCK','ORG-OTSINDO','CLI-CRIT','SUB-LOCK','APPROVED_FOR_PAYMENT',5000000,'maker','PI-LOCK-key','PI/LOCK','${'d'.repeat(64)}','IDR',1);
    INSERT INTO payment_gateway_transactions
      (id,org_id,client_id,payment_instruction_id,provider,status,amount,currency,idempotency_key,request_hash,created_by)
      VALUES('PGT-LOCK','ORG-OTSINDO','CLI-CRIT','PI-LOCK','E2PAY','CREATED',5000000,'IDR','PGT-LOCK-key','${'e'.repeat(64)}','processor');
  `);
  const first=await acquireExecutionLease(DB,'PGT-LOCK');
  assert.ok(first);
  const second=await acquireExecutionLease(DB,'PGT-LOCK');
  assert.equal(second,null);
  await releaseExecutionLease(DB,'PGT-LOCK',first);
  const third=await acquireExecutionLease(DB,'PGT-LOCK');
  assert.ok(third);
  await releaseExecutionLease(DB,'PGT-LOCK',third);
});


test('VALIDATE detects corrupted payroll control totals instead of only changing status',async()=>{
  const DB=new D1Mock(); seedPayroll(DB);
  const processor={id:'USR-V',email:'validator@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:[]};
  const created=await direct(DB,processor,{action:'CREATE_PAY_RUN',clientId:'CLI-CRIT',projectId:'PRJ-CRIT',servicePlanId:'SP-CRIT',period:'2026-10',paymentPeriod:'2026-10',paymentDate:'2026-10-25',runType:'REGULAR',sourceMode:'MASTER_CURRENT'});
  assert.equal(created.response.status,201,JSON.stringify(created.payload));
  const id=created.payload.submission.id;
  assert.equal((await direct(DB,processor,{action:'FINALIZE_PAY_RUN_INPUT',submissionId:id,confirmation:'DATA PAYROLL FINAL'})).response.status,200);

  // Simulate a corrupted canonical snapshot that still has positive THP and bank data.
  DB.sqlite.prepare('UPDATE payroll_run_lines SET deduction_amount=100000,net_amount=5000000 WHERE submission_id=?').run(id);
  const invalid=await direct(DB,processor,{action:'ADVANCE_PAY_RUN',submissionId:id,command:'VALIDATE',reviewConfirmed:true});
  assert.equal(invalid.response.status,200,JSON.stringify(invalid.payload));
  assert.equal(invalid.payload.submission.state,'EXCEPTION_FOUND');
  assert.ok(Number(invalid.payload.blockingCount)>0);
  const exception=DB.sqlite.prepare("SELECT status FROM payroll_exceptions WHERE submission_id=? AND category='SYSTEM_PAYROLL_CONTROL_MISMATCH' ORDER BY created_at DESC LIMIT 1").get(id);
  assert.equal(exception.status,'OPEN');

  DB.sqlite.prepare('UPDATE payroll_run_lines SET deduction_amount=0,net_amount=5000000 WHERE submission_id=?').run(id);
  const refinalized=await direct(DB,processor,{action:'FINALIZE_PAY_RUN_INPUT',submissionId:id,confirmation:'DATA PAYROLL FINAL'});
  assert.equal(refinalized.response.status,200,JSON.stringify(refinalized.payload));
  const valid=await direct(DB,processor,{action:'ADVANCE_PAY_RUN',submissionId:id,command:'VALIDATE',reviewConfirmed:true});
  assert.equal(valid.response.status,200,JSON.stringify(valid.payload));
  assert.equal(valid.payload.submission.state,'VALIDATED');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM payroll_exceptions WHERE submission_id=? AND category LIKE 'SYSTEM_%' AND status='OPEN'").get(id).count,0);
});


test('Controller review locks canonical payroll snapshot until revision is requested',async()=>{
  const DB=new D1Mock(); seedPayroll(DB);
  const processor={id:'USR-LP',email:'lock.processor@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:[]};
  const created=await direct(DB,processor,{action:'CREATE_PAY_RUN',clientId:'CLI-CRIT',projectId:'PRJ-CRIT',servicePlanId:'SP-CRIT',period:'2026-11',paymentPeriod:'2026-11',paymentDate:'2026-11-25',runType:'REGULAR',sourceMode:'MASTER_CURRENT'});
  assert.equal(created.response.status,201,JSON.stringify(created.payload));
  const id=created.payload.submission.id;
  assert.equal((await direct(DB,processor,{action:'FINALIZE_PAY_RUN_INPUT',submissionId:id,confirmation:'DATA PAYROLL FINAL'})).response.status,200);
  assert.equal((await direct(DB,processor,{action:'ADVANCE_PAY_RUN',submissionId:id,command:'VALIDATE',reviewConfirmed:true})).payload.submission.state,'VALIDATED');
  const handedOff=await direct(DB,processor,{action:'ADVANCE_PAY_RUN',submissionId:id,command:'FINALIZE_PAYROLL',reviewConfirmed:true,reviewNote:'Hand off to Controller'});
  assert.equal(handedOff.payload.submission.state,'CONTROLLER_REVIEW');

  const refinalize=await direct(DB,processor,{action:'FINALIZE_PAY_RUN_INPUT',submissionId:id,confirmation:'DATA PAYROLL FINAL'});
  assert.equal(refinalize.response.status,409);
  assert.equal(refinalize.payload.code,'PAY_RUN_INPUT_LOCKED_FOR_REVIEW');
  assert.throws(
    ()=>DB.sqlite.prepare('UPDATE payroll_run_lines SET net_amount=net_amount-1 WHERE submission_id=?').run(id),
    /payroll run snapshot is locked/,
  );
});
