import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { validateOperatingAction } from '../functions/api/operating-model-validation.js';
import { derivePayrollNextAction } from '../src/lib/payroll-next-action-core.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const env=(DB)=>({DB,DEFAULT_ORG_ID:'ORG-OTSINDO',PI_ENCRYPTION_KEY:'phase5-client-approval-key-32-bytes-minimum'});
const request=(body)=>new Request(origin+'/api/operating-model',{
  method:'POST',
  headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},
  body:JSON.stringify(body),
});

const processor={id:'USR-P5-P',email:'processor.p5@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:['payment:prepare']};
const controller={id:'USR-P5-C',email:'controller.p5@proqpay.test',role:'PAYROLL_CONTROLLER',permissions:['payment:approve']};
const client={id:'USR-P5-CL',email:'client.p5@proqpay.test',role:'CLIENT_USER',permissions:['read'],clientIds:['CLI-P5'],projectIds:['PRJ-P5']};

function seed(DB,state='CONTROLLER_REVIEW',id='SUB-P5') {
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO clients(id,org_id,code,name) VALUES('CLI-P5','ORG-OTSINDO','P5','PT Phase Five');
    INSERT OR IGNORE INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-P5','ORG-OTSINDO','CLI-P5','P5','Project Phase Five','seed');
    INSERT OR IGNORE INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-P5','CLI-P5','PRJ-P5','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
    INSERT OR IGNORE INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-P5','ORG-OTSINDO','CLI-P5','PRJ-P5','P5-001','Employee Phase Five','ACTIVE');
    INSERT OR IGNORE INTO employee_compensation(employee_id,basic_salary)
      VALUES('EMP-P5',5000000);
    INSERT OR IGNORE INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
      VALUES('BANK-P5','EMP-P5','BCA','1234567890',1);
  `);
  DB.sqlite.prepare(`INSERT INTO payroll_submissions
    (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by,processor_reviewed_by,processor_review_note)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,'ORG-OTSINDO','CLI-P5','PRJ-P5','SP-P5','TIER_2_MANAGED_PAYROLL','2026-09','2026-09',
      'REGULAR','MASTER_CURRENT','READY',state,'seed',processor.email,'Processor review complete'
    );
  DB.sqlite.prepare(`INSERT INTO payroll_run_lines
    (id,submission_id,employee_id,employee_code,employee_name,bank_name,account_last4,gross_amount,deduction_amount,net_amount,components,source,included)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      'PRL-'+id,id,'EMP-P5','P5-001','Employee Phase Five','BCA','7890',5500000,500000,5000000,'{}','MASTER_CURRENT'
    );
}

async function act(DB,actor,body) {
  const response=await handleD1OperatingModel({request:request(body),env:env(DB)},actor);
  return {response,payload:await response.json()};
}

test('Phase 5 routes Controller approval to Client Approval Pending without creating PI',async()=>{
  const DB=new D1Mock(); seed(DB);
  const result=await act(DB,controller,{
    action:'TRANSITION_SUBMISSION',submissionId:'SUB-P5',toState:'CLIENT_APPROVAL_PENDING',
    reviewConfirmed:true,reviewNote:'Controller verified payroll totals and variance',
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.submission.state,'CLIENT_APPROVAL_PENDING');
  assert.equal(result.payload.submission.controller_reviewed_by,controller.email);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM payment_instructions WHERE submission_id='SUB-P5'").get().count,0);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_id='SUB-P5' AND action='PAYROLL_SENT_FOR_CLIENT_APPROVAL'").get().count,1);
});

test('Client approval is scoped, audited, idempotent, and becomes the PI prerequisite',async()=>{
  const DB=new D1Mock(); seed(DB,'CLIENT_APPROVAL_PENDING');
  DB.sqlite.prepare("UPDATE payroll_submissions SET controller_reviewed_by=?,controller_reviewed_at=datetime('now') WHERE id='SUB-P5'").run(controller.email);

  const wrongClient={...client,id:'USR-WRONG',email:'wrong@proqpay.test',clientIds:['CLI-OTHER'],projectIds:[]};
  let result=await act(DB,wrongClient,{
    action:'CLIENT_APPROVE_PAYROLL',submissionId:'SUB-P5',reviewConfirmed:true,
    confirmation:'SETUJUI PAYROLL',reviewNote:'Reviewed',
  });
  assert.equal(result.response.status,403);

  result=await act(DB,client,{
    action:'CLIENT_APPROVE_PAYROLL',submissionId:'SUB-P5',reviewConfirmed:true,
    confirmation:'SETUJUI PAYROLL',reviewNote:'Payroll September approved',
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.submission.state,'CLIENT_APPROVED');
  assert.equal(result.payload.submission.client_reviewed_by,client.email);
  assert.equal(result.payload.submission.client_review_decision,'APPROVED');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_id='SUB-P5' AND action='CLIENT_PAYROLL_APPROVED'").get().count,1);

  const replay=await act(DB,client,{
    action:'CLIENT_APPROVE_PAYROLL',submissionId:'SUB-P5',reviewConfirmed:true,
    confirmation:'SETUJUI PAYROLL',reviewNote:'Payroll September approved',
  });
  assert.equal(replay.response.status,200);
  assert.equal(replay.payload.idempotentReplay,true);

  const generated=await act(DB,processor,{action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:'SUB-P5'});
  assert.equal(generated.response.status,201,JSON.stringify(generated.payload));
  assert.equal(generated.payload.paymentInstruction.status,'PAYMENT_INSTRUCTION_READY');
  assert.equal(DB.sqlite.prepare("SELECT state FROM payroll_submissions WHERE id='SUB-P5'").get().state,'PAYMENT_INSTRUCTION_READY');
});

test('Client can request revision; snapshot unlocks for Processor correction and must restart review',async()=>{
  const DB=new D1Mock(); seed(DB,'CLIENT_APPROVAL_PENDING','SUB-P5-REV');
  DB.sqlite.prepare("UPDATE payroll_submissions SET controller_reviewed_by=?,controller_reviewed_at=datetime('now') WHERE id='SUB-P5-REV'").run(controller.email);
  const result=await act(DB,client,{
    action:'CLIENT_REQUEST_PAYROLL_REVISION',submissionId:'SUB-P5-REV',
    reason:'Mohon koreksi nilai lembur karyawan sebelum payroll disetujui.',
    confirmation:'MINTA REVISI PAYROLL',
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.submission.state,'CLIENT_REVISION_REQUESTED');
  assert.equal(result.payload.submission.input_status,'PENDING');
  assert.equal(result.payload.submission.client_review_decision,'REVISION_REQUESTED');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_id='SUB-P5-REV' AND action='CLIENT_PAYROLL_REVISION_REQUESTED'").get().count,1);

  assert.doesNotThrow(()=>DB.sqlite.prepare("UPDATE payroll_run_lines SET gross_amount=5600000,net_amount=5100000 WHERE submission_id='SUB-P5-REV'").run());

  const generated=await act(DB,processor,{action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:'SUB-P5-REV'});
  assert.equal(generated.response.status,409);
  assert.equal(generated.payload.code,'CLIENT_PAYROLL_APPROVAL_REQUIRED');
});

test('Phase 5 decision validation and next-action contracts are explicit',async()=>{
  assert.equal(validateOperatingAction({
    action:'CLIENT_APPROVE_PAYROLL',submissionId:'SUB-P5',reviewConfirmed:true,confirmation:'SETUJUI PAYROLL',
  }).ok,true);
  assert.equal(validateOperatingAction({
    action:'CLIENT_APPROVE_PAYROLL',submissionId:'SUB-P5',reviewConfirmed:true,confirmation:'approve',
  }).ok,false);
  assert.equal(validateOperatingAction({
    action:'CLIENT_REQUEST_PAYROLL_REVISION',submissionId:'SUB-P5',reason:'terlalu pendek',confirmation:'MINTA REVISI PAYROLL',
  }).ok,false);

  assert.equal(derivePayrollNextAction({role:'PAYROLL_CONTROLLER',state:'CONTROLLER_REVIEW'}).workflowCommand,'CLIENT_APPROVAL_PENDING');
  assert.equal(derivePayrollNextAction({role:'CLIENT_USER',state:'CLIENT_APPROVAL_PENDING'}).code,'APPROVE_PAYROLL');
  assert.equal(derivePayrollNextAction({role:'PAYROLL_PROCESSOR',state:'CLIENT_APPROVAL_PENDING'}).code,'WAIT_CLIENT_APPROVAL');
  assert.equal(derivePayrollNextAction({role:'PAYROLL_PROCESSOR',state:'CLIENT_APPROVED'}).code,'GENERATE_PAYMENT_INSTRUCTION');
  assert.equal(derivePayrollNextAction({role:'CLIENT_USER',state:'CLIENT_REVISION_REQUESTED'}).code,'WAIT_PAYROLL_REVISION');

  const ui=await readFile(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
  assert.match(ui,/CLIENT_APPROVE_PAYROLL/);
  assert.match(ui,/CLIENT_REQUEST_PAYROLL_REVISION/);
  assert.match(ui,/confirmation:'SETUJUI PAYROLL'/);
  assert.match(ui,/confirmation:'MINTA REVISI PAYROLL'/);
  assert.match(ui,/ClientApprovalPreview/);
  assert.match(ui,/tanpa informasi rekening/);
});
