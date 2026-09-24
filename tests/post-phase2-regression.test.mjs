import assert from 'node:assert/strict';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { derivePayrollBusinessStage } from '../src/lib/payroll-business-stage-core.js';
import { derivePayrollNextAction } from '../src/lib/payroll-next-action-core.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const env=(DB)=>({DB,DEFAULT_ORG_ID:'ORG-OTSINDO'});
const get=(path)=>new Request(origin+path,{method:'GET',headers:{Accept:'application/json'}});

function seedScopedPayments(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-SCOPE','ORG-OTSINDO','SCOPE','PT Scope');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES
      ('PRJ-A','ORG-OTSINDO','CLI-SCOPE','A','Project A','seed'),
      ('PRJ-B','ORG-OTSINDO','CLI-SCOPE','B','Project B','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by) VALUES
      ('SP-A','CLI-SCOPE','PRJ-A','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed'),
      ('SP-B','CLI-SCOPE','PRJ-B','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,input_status,created_by)
      VALUES
      ('SUB-A','ORG-OTSINDO','CLI-SCOPE','PRJ-A','SP-A','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','COMPLETED','READY','seed'),
      ('SUB-B','ORG-OTSINDO','CLI-SCOPE','PRJ-B','SP-B','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','COMPLETED','READY','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count)
      VALUES
      ('PI-A','ORG-OTSINDO','CLI-SCOPE','SUB-A','COMPLETED',1000000,'maker','PI-A-key','PI/A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','IDR',1),
      ('PI-B','ORG-OTSINDO','CLI-SCOPE','SUB-B','COMPLETED',2000000,'maker','PI-B-key','PI/B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','IDR',1);
    INSERT INTO payment_proofs(id,payment_instruction_id,bank,reference,transaction_date,amount,uploaded_file_id) VALUES
      ('PP-A','PI-A','BCA','REF-A','2026-09-25',1000000,'FILE-A'),
      ('PP-B','PI-B','BCA','REF-B','2026-09-25',2000000,'FILE-B');
    INSERT INTO reconciliations(id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status,reviewed_by) VALUES
      ('REC-A','PI-A',1000000,1000000,1000000,0,'MATCHED','processor'),
      ('REC-B','PI-B',2000000,2000000,2000000,0,'MATCHED','processor');
  `);
}

test('CLIENT_USER detail reads self-scope from record and deny another project in the same client', async()=>{
  const DB=new D1Mock(); seedScopedPayments(DB);
  const actor={id:'USR-CLIENT',email:'client@scope.test',role:'CLIENT_USER',permissions:['read'],clientIds:['CLI-SCOPE'],projectIds:['PRJ-A']};

  let response=await handleD1OperatingModel({request:get('/api/operating-model?resource=pay-run-detail&submissionId=SUB-A'),env:env(DB)},actor);
  assert.equal(response.status,200,await response.clone().text());

  response=await handleD1OperatingModel({request:get('/api/operating-model?resource=payment-instruction-detail&paymentInstructionId=PI-A'),env:env(DB)},actor);
  assert.equal(response.status,200,await response.clone().text());

  response=await handleD1OperatingModel({request:get('/api/operating-model?resource=payment-instruction-detail&paymentInstructionId=PI-B'),env:env(DB)},actor);
  assert.equal(response.status,403,await response.clone().text());
});

test('CLIENT_USER payment proof and reconciliation lists are project scoped', async()=>{
  const DB=new D1Mock(); seedScopedPayments(DB);
  const actor={id:'USR-CLIENT',email:'client@scope.test',role:'CLIENT_USER',permissions:['read'],clientIds:['CLI-SCOPE'],projectIds:['PRJ-A']};

  let response=await handleD1OperatingModel({request:get('/api/operating-model?resource=payment-proofs&clientId=CLI-SCOPE'),env:env(DB)},actor);
  assert.equal(response.status,200,await response.clone().text());
  let body=await response.json();
  assert.deepEqual(body.paymentProofs.map((row)=>row.id),['PP-A']);

  response=await handleD1OperatingModel({request:get('/api/operating-model?resource=reconciliations&clientId=CLI-SCOPE'),env:env(DB)},actor);
  assert.equal(response.status,200,await response.clone().text());
  body=await response.json();
  assert.deepEqual(body.reconciliations.map((row)=>row.id),['REC-A']);
});

test('reconciled payroll remains active through Billing & Close until invoice/AR is actually complete',()=>{
  let stage=derivePayrollBusinessStage({state:'COMPLETED',reconciliationStatus:'MATCHED'});
  assert.equal(stage.stage,'CLOSE');
  assert.equal(stage.isTerminal,false);
  assert.equal(stage.status,'PROCESSING');

  let action=derivePayrollNextAction({role:'PAYROLL_PROCESSOR',state:'COMPLETED',reconciliationStatus:'MATCHED'});
  assert.equal(action.code,'PREPARE_BILLING');
  assert.equal(action.actionable,true);

  stage=derivePayrollBusinessStage({state:'COMPLETED',reconciliationStatus:'MATCHED',invoiceStatus:'PAID',arStatus:'PAID',periodStatus:'OPEN'});
  assert.equal(stage.isTerminal,false);
  assert.equal(stage.status,'PROCESSING');

  action=derivePayrollNextAction({role:'PAYROLL_PROCESSOR',state:'COMPLETED',reconciliationStatus:'MATCHED',invoiceStatus:'PAID',arStatus:'PAID',periodStatus:'OPEN'});
  assert.equal(action.code,'WAIT_PERIOD_CLOSE');
  assert.equal(action.actionable,false);

  stage=derivePayrollBusinessStage({state:'COMPLETED',reconciliationStatus:'MATCHED',invoiceStatus:'PAID',arStatus:'PAID',periodStatus:'CLOSED'});
  assert.equal(stage.isTerminal,true);
  assert.equal(stage.status,'COMPLETED');

  action=derivePayrollNextAction({role:'PAYROLL_PROCESSOR',state:'COMPLETED',reconciliationStatus:'MATCHED',invoiceStatus:'PAID',arStatus:'PAID',periodStatus:'CLOSED'});
  assert.equal(action.code,'VIEW_CLOSED_CYCLE');
  assert.equal(action.actionable,false);
});

test('cancelled and rejected Pay Runs never emit executable next actions even when input is pending',()=>{
  for(const state of ['CANCELLED','REJECTED']){
    const action=derivePayrollNextAction({
      role:'PAYROLL_PROCESSOR',
      state,
      inputStatus:'PENDING',
      sourceMode:'MASTER_CURRENT',
      blockingCount:0,
    });
    assert.equal(action.stage.isTerminal,true,state);
    assert.equal(action.actionable,false,state);
    assert.equal(action.code,'VIEW_FINAL_STATUS',state);
  }
});

test('dashboard active employee KPI uses canonical payroll eligibility semantics', async()=>{
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-HC','ORG-OTSINDO','HC','PT Headcount');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-HC','ORG-OTSINDO','CLI-HC','HC','Headcount Project','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif) VALUES
      ('EMP-TETAP','ORG-OTSINDO','CLI-HC','PRJ-HC','E1','Tetap','TETAP'),
      ('EMP-PKWT','ORG-OTSINDO','CLI-HC','PRJ-HC','E2','PKWT','PKWT'),
      ('EMP-OFF','ORG-OTSINDO','CLI-HC','PRJ-HC','E3','Inactive','INACTIVE');
  `);
  const actor={id:'USR-SA',email:'admin@proqpay.test',role:'SUPER_ADMIN',permissions:[]};
  const response=await handleD1OperatingModel({request:get('/api/operating-model?resource=dashboard'),env:env(DB)},actor);
  assert.equal(response.status,200,await response.clone().text());
  const body=await response.json();
  assert.equal(body.portfolioSummary.employees,3);
  assert.equal(body.portfolioSummary.activeEmployees,2);
});


test('client correction next action remains exception-owned while Phase 4 routes it through Payroll', async()=>{
  const action=derivePayrollNextAction({role:'CLIENT_USER',state:'CLIENT_ACTION_REQUIRED'});
  assert.equal(action.code,'CORRECT_PAYROLL_DATA');
  assert.equal(action.view,'exceptions');
  assert.equal(action.actionable,true);

  const fs=await import('node:fs/promises');
  const sidebar=await fs.readFile(new URL('../src/components/Sidebar.tsx',import.meta.url),'utf8');
  const workspace=await fs.readFile(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
  assert.match(sidebar,/CLIENT_USER: \["dashboard", "operations", "reports"\]/);
  assert.match(sidebar,/title="Payroll"/);
  assert.match(workspace,/role === 'CLIENT_USER' \? 'CLIENT_ACTION_REQUIRED' : 'ACTIVE'/);
  assert.match(workspace,/clientCorrections=openExceptions\.filter/);
});
