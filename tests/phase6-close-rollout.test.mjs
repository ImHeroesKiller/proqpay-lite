import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { derivePayrollBusinessStage } from '../src/lib/payroll-business-stage-core.js';
import { derivePayrollNextAction } from '../src/lib/payroll-next-action-core.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const controller={id:'USR-P6-C',email:'controller.p6@proqpay.test',role:'PAYROLL_CONTROLLER',permissions:['payment:approve']};
const processor={id:'USR-P6-P',email:'processor.p6@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:['payment:prepare']};
const request=(body)=>new Request(origin+'/api/operating-model',{
  method:'POST',
  headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},
  body:JSON.stringify(body),
});

function seed(DB,{invoiceStatus='DRAFT'}={}) {
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-P6','ORG-OTSINDO','P6','PT Phase Six');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-P6','ORG-OTSINDO','CLI-P6','P6','Project Phase Six','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-P6','CLI-P6','PRJ-P6','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,period_status,state,created_by)
      VALUES('SUB-P6','ORG-OTSINDO','CLI-P6','PRJ-P6','SP-P6','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','OPEN','COMPLETED','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,currency,recipient_count)
      VALUES('PI-P6','ORG-OTSINDO','CLI-P6','SUB-P6','COMPLETED',5000000,'maker','PI-P6-key','PI/P6','IDR',1);
    INSERT INTO reconciliations
      (id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status,reviewed_by)
      VALUES('REC-P6','PI-P6',5000000,5000000,5000000,0,'MATCHED','controller');
    INSERT INTO invoices
      (id,org_id,client_id,project_id,payment_instruction_id,invoice_number,company,period,amount,subtotal,total_amount,status,created_by,tax_invoice_status,items)
      VALUES('INV-P6','ORG-OTSINDO','CLI-P6','PRJ-P6','PI-P6','INV/P6','PT Phase Six','2026-09',100000,100000,100000,'${invoiceStatus}','processor','NOT_REQUIRED','[]');
    INSERT INTO ar_monitor
      (id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,type)
      VALUES('AR-P6','ORG-OTSINDO','CLI-P6','PRJ-P6','PT Phase Six','INV-P6',100000,0,100000,'OUTSTANDING','2026-10-30','INVOICE');
  `);
}

async function act(DB,actor,body) {
  const response=await handleD1OperatingModel({
    request:request(body),
    env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO'},
  },actor);
  return {response,payload:await response.json()};
}

test('Phase 6 blocks premature close and exposes readiness reasons',async()=>{
  const DB=new D1Mock(); seed(DB,{invoiceStatus:'DRAFT'});
  const result=await act(DB,controller,{action:'CLOSE_PAY_RUN',submissionId:'SUB-P6',confirmation:'TUTUP PERIODE'});
  assert.equal(result.response.status,409,JSON.stringify(result.payload));
  assert.equal(result.payload.code,'CLOSE_READINESS_REQUIRED');
  assert.equal(result.payload.readiness.ready,false);
  assert.ok(result.payload.readiness.reasons.includes('INVOICE_NOT_ISSUED'));
  assert.equal(DB.sqlite.prepare("SELECT period_status FROM payroll_submissions WHERE id='SUB-P6'").get().period_status,'OPEN');
});

test('Phase 6 closes only after payment matched and invoice issued; AR may remain outstanding',async()=>{
  const DB=new D1Mock(); seed(DB,{invoiceStatus:'ISSUED'});

  const denied=await act(DB,processor,{action:'CLOSE_PAY_RUN',submissionId:'SUB-P6',confirmation:'TUTUP PERIODE'});
  assert.equal(denied.response.status,403);

  const result=await act(DB,controller,{action:'CLOSE_PAY_RUN',submissionId:'SUB-P6',confirmation:'TUTUP PERIODE'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.submission.period_status,'CLOSED');
  assert.equal(result.payload.readiness.ready,true);
  assert.equal(result.payload.readiness.reconciliationStatus,'MATCHED');
  assert.equal(result.payload.readiness.invoiceStatus,'ISSUED');
  assert.equal(DB.sqlite.prepare("SELECT status FROM ar_monitor WHERE id='AR-P6'").get().status,'OUTSTANDING',
    'AR collection must continue independently after payroll period close');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_id='SUB-P6' AND action='PAY_RUN_CLOSED'").get().count,1);

  const replay=await act(DB,controller,{action:'CLOSE_PAY_RUN',submissionId:'SUB-P6',confirmation:'TUTUP PERIODE'});
  assert.equal(replay.response.status,200);
  assert.equal(replay.payload.idempotentReplay,true);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_id='SUB-P6' AND action='PAY_RUN_CLOSED'").get().count,1);
});

test('paid invoice alone no longer marks a payroll cycle closed',()=>{
  let stage=derivePayrollBusinessStage({
    state:'COMPLETED',
    reconciliationStatus:'MATCHED',
    invoiceStatus:'PAID',
    arStatus:'PAID',
    periodStatus:'OPEN',
  });
  assert.equal(stage.stage,'CLOSE');
  assert.equal(stage.isTerminal,false);
  assert.equal(stage.status,'PROCESSING');

  stage=derivePayrollBusinessStage({
    state:'COMPLETED',
    reconciliationStatus:'MATCHED',
    invoiceStatus:'ISSUED',
    arStatus:'OUTSTANDING',
    periodStatus:'CLOSED',
  });
  assert.equal(stage.isTerminal,true);
  assert.equal(stage.status,'COMPLETED');
  assert.match(stage.reason,/formally closed/i);
});

test('Phase 6 close next actions are role-aware and do not conflate AR collection with period close',()=>{
  assert.equal(derivePayrollNextAction({
    ...processor,state:'COMPLETED',reconciliationStatus:'MATCHED',periodStatus:'OPEN',
  }).code,'PREPARE_BILLING');

  assert.equal(derivePayrollNextAction({
    ...processor,state:'COMPLETED',reconciliationStatus:'MATCHED',invoiceStatus:'DRAFT',periodStatus:'OPEN',
  }).code,'SUBMIT_INVOICE');

  assert.equal(derivePayrollNextAction({
    ...controller,state:'COMPLETED',reconciliationStatus:'MATCHED',invoiceStatus:'UNDER_REVIEW',periodStatus:'OPEN',
  }).code,'REVIEW_INVOICE');

  const closeAction=derivePayrollNextAction({
    ...controller,state:'COMPLETED',reconciliationStatus:'MATCHED',invoiceStatus:'ISSUED',arStatus:'OUTSTANDING',periodStatus:'OPEN',
  });
  assert.equal(closeAction.code,'CLOSE_PAY_RUN');
  assert.equal(closeAction.workflowCommand,'CLOSE_PAY_RUN');
  assert.equal(closeAction.actionable,true);

  const closed=derivePayrollNextAction({
    ...controller,state:'COMPLETED',reconciliationStatus:'MATCHED',invoiceStatus:'ISSUED',arStatus:'OUTSTANDING',periodStatus:'CLOSED',
  });
  assert.equal(closed.code,'VIEW_CLOSED_CYCLE');
  assert.equal(closed.actionable,false);
});

test('Close & Billing workspace exposes rollout-ready close controls',async()=>{
  const billing=await readFile(new URL('../src/components/BillingWorkspace.tsx',import.meta.url),'utf8');
  const workspace=await readFile(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
  assert.match(billing,/Cycle Close/);
  assert.match(billing,/Payroll Cycle Close/);
  assert.match(billing,/action: "CLOSE_PAY_RUN"/);
  assert.match(billing,/confirmation: "TUTUP PERIODE"/);
  assert.match(billing,/AR tetap dipantau/);
  assert.match(workspace,/Close readiness/);
  assert.doesNotMatch(workspace,/\['PAYROLL_FINALIZED','COMPLETED'\]\.includes\(selected\.state\)/);
});


test('production rollout pipeline enforces post-deploy smoke checks',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/cloudflare-deploy.yml',import.meta.url),'utf8');
  const smoke=await readFile(new URL('../scripts/production-smoke.mjs',import.meta.url),'utf8');
  const runbook=await readFile(new URL('../ROLLOUT_RUNBOOK.md',import.meta.url),'utf8');
  assert.match(workflow,/Production smoke test/);
  assert.match(workflow,/node scripts\/production-smoke\.mjs https:\/\/proqpay-lite\.pages\.dev/);
  assert.ok(workflow.indexOf('Verify production health') < workflow.indexOf('Production smoke test'));
  assert.match(smoke,/\/api\/health/);
  assert.match(smoke,/\/api\/operating-model\?resource=submissions/);
  assert.match(smoke,/json\(path, 401\)/);
  assert.match(runbook,/Prepare → Review → Approve → Pay → Close/);
  assert.match(runbook,/Outstanding AR does \*\*not\*\* block payroll period close/);
});
