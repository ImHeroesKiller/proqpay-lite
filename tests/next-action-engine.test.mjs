import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { derivePayrollNextAction } from '../src/lib/payroll-next-action-core.js';
import { STATES } from '../functions/api/operating-model-validation.js';

const processor={role:'PAYROLL_PROCESSOR',permissions:['payment:prepare','reconciliation:write']};
const controller={role:'PAYROLL_CONTROLLER',permissions:['payment:approve','reconciliation:write']};
const client={role:'CLIENT_USER',permissions:['read']};

test('Processor gets one clear primary action during Prepare and Review', () => {
  assert.equal(derivePayrollNextAction({...processor,state:'DRAFT',inputStatus:'PENDING',sourceMode:'UPLOAD_FINAL'}).code,'COMPLETE_DATA_INTAKE');
  assert.equal(derivePayrollNextAction({...processor,state:'DRAFT',inputStatus:'READY',sourceMode:'MASTER_CURRENT'}).code,'VALIDATE_PAYROLL');
  assert.equal(derivePayrollNextAction({...processor,state:'VALIDATED',inputStatus:'READY'}).code,'FINALIZE_PAYROLL');
  assert.equal(derivePayrollNextAction({...processor,state:'EXCEPTION_FOUND',blockingCount:2}).code,'RESOLVE_PAYROLL_ISSUES');
});

test('Controller action starts only at approval checkpoints', () => {
  let action=derivePayrollNextAction({...controller,state:'STANDARDIZED'});
  assert.equal(action.code,'WAIT_PROCESSOR');
  assert.equal(action.actionable,false);

  action=derivePayrollNextAction({...controller,state:'CONTROLLER_REVIEW'});
  assert.equal(action.code,'REVIEW_APPROVE_PAYROLL');
  assert.equal(action.actionable,true);
  assert.equal(action.workflowCommand,'CLIENT_APPROVAL_PENDING');

  action=derivePayrollNextAction({...controller,state:'CLIENT_APPROVAL_PENDING'});
  assert.equal(action.code,'WAIT_CLIENT_APPROVAL');
  assert.equal(action.actionable,false);

  action=derivePayrollNextAction({...processor,state:'CLIENT_APPROVED'});
  assert.equal(action.code,'GENERATE_PAYMENT_INSTRUCTION');
  assert.equal(action.workflowCommand,'GENERATE_PAYMENT_INSTRUCTION');
});

test('PI generation and PI submission are not confused', () => {
  let action=derivePayrollNextAction({...processor,state:'PAYMENT_INSTRUCTION_READY',hasPaymentInstruction:false});
  assert.equal(action.code,'GENERATE_PAYMENT_INSTRUCTION');
  assert.equal(action.view,'operations');
  assert.equal(action.workflowCommand,'GENERATE_PAYMENT_INSTRUCTION');

  action=derivePayrollNextAction({...processor,state:'PAYMENT_INSTRUCTION_READY',hasPaymentInstruction:true,paymentInstructionStatus:'PAYMENT_INSTRUCTION_READY'});
  assert.equal(action.code,'SUBMIT_PAYMENT_INSTRUCTION');
  assert.equal(action.view,'payments');
  assert.equal(action.workflowCommand,null);
});

test('Payment approval belongs to Controller while execution belongs to Processor', () => {
  let action=derivePayrollNextAction({...processor,state:'PAYMENT_APPROVAL_PENDING',hasPaymentInstruction:true,paymentInstructionStatus:'PAYMENT_APPROVAL_PENDING'});
  assert.equal(action.code,'WAIT_PAYMENT_APPROVAL');
  assert.equal(action.actionable,false);

  action=derivePayrollNextAction({...controller,state:'PAYMENT_APPROVAL_PENDING',hasPaymentInstruction:true,paymentInstructionStatus:'PAYMENT_APPROVAL_PENDING'});
  assert.equal(action.code,'REVIEW_APPROVE_PAYMENT');
  assert.equal(action.actionable,true);

  action=derivePayrollNextAction({...processor,state:'APPROVED_FOR_PAYMENT',hasPaymentInstruction:true,paymentInstructionStatus:'APPROVED_FOR_PAYMENT'});
  assert.equal(action.code,'PROCESS_PAYMENT');
  assert.equal(action.actionable,true);

  action=derivePayrollNextAction({...controller,state:'APPROVED_FOR_PAYMENT',hasPaymentInstruction:true,paymentInstructionStatus:'APPROVED_FOR_PAYMENT'});
  assert.equal(action.code,'WAIT_PAYMENT_EXECUTION');
  assert.equal(action.actionable,false);
});

test('Reconciliation is actionable for authorized internal roles and monitoring-only for client', () => {
  assert.equal(derivePayrollNextAction({...processor,state:'RECONCILIATION',reconciliationStatus:'PENDING'}).code,'RECONCILE_PAYMENT');
  assert.equal(derivePayrollNextAction({...controller,state:'RECONCILIATION',reconciliationStatus:'PENDING'}).code,'RECONCILE_PAYMENT');

  const action=derivePayrollNextAction({...client,state:'RECONCILIATION',reconciliationStatus:'PENDING'});
  assert.equal(action.code,'VIEW_RESULTS');
  assert.equal(action.actionable,false);
});

test('Client involvement stays simple: correct, approve, or monitor', () => {
  let action=derivePayrollNextAction({...client,state:'CLIENT_ACTION_REQUIRED'});
  assert.equal(action.code,'CORRECT_PAYROLL_DATA');
  assert.equal(action.actionable,true);

  action=derivePayrollNextAction({...client,state:'CLIENT_APPROVAL_PENDING'});
  assert.equal(action.code,'APPROVE_PAYROLL');
  assert.equal(action.actionable,true);

  action=derivePayrollNextAction({...client,state:'DISBURSEMENT_PROCESSING',paymentInstructionStatus:'DISBURSEMENT_PROCESSING'});
  assert.equal(action.code,'MONITOR_PAYMENT');
  assert.equal(action.actionable,false);

  action=derivePayrollNextAction({...client,state:'COMPLETED',reconciliationStatus:'MATCHED'});
  assert.equal(action.code,'VIEW_RESULTS');
  assert.equal(action.actionable,false);
});

test('Client action required never appears as Processor-owned work', () => {
  const action=derivePayrollNextAction({...processor,state:'CLIENT_ACTION_REQUIRED',blockingCount:3});
  assert.equal(action.code,'WAIT_CLIENT_CORRECTION');
  assert.equal(action.actionable,false);
  assert.equal(action.owner,'CLIENT_USER');
});

test('every canonical technical state returns exactly one next-action contract per core role', () => {
  for (const roleContext of [processor,controller,client]) {
    for (const state of STATES) {
      const action=derivePayrollNextAction({...roleContext,state,inputStatus:'READY'});
      assert.equal(typeof action.code,'string',`${roleContext.role} ${state}`);
      assert.ok(action.code.length>0,`${roleContext.role} ${state}`);
      assert.ok(['operations','exceptions','payments','billing','reports'].includes(action.view),`${roleContext.role} ${state}: ${action.view}`);
      assert.equal(typeof action.actionable,'boolean',`${roleContext.role} ${state}`);
      assert.ok(action.stage && action.stage.knownState,`${roleContext.role} ${state}`);
    }
  }
});

test('cancelled and rejected pay runs are terminal and do not generate phantom work', () => {
  for (const state of ['CANCELLED','REJECTED']) {
    const action=derivePayrollNextAction({...processor,state,inputStatus:'READY'});
    assert.equal(action.stage.isTerminal,true,state);
  }
});

test('Control Tower Action Center consumes only actionable engine output', async () => {
  const source=await readFile(new URL('../src/components/PayrollControlTower.tsx',import.meta.url),'utf8');
  assert.match(source,/derivePayrollNextAction/);
  assert.match(source,/filter\(\(row\)=>row\.nextAction\.actionable\)/);
  assert.doesNotMatch(source,/PI menunggu approval/);
  assert.doesNotMatch(source,/Workflow perlu dilanjutkan/);
});

test('Pay Run workspace uses engine workflowCommand instead of duplicated nextFor/actionName maps', async () => {
  const source=await readFile(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
  assert.match(source,/derivePayrollNextAction/);
  assert.match(source,/const next=nextAction\.workflowCommand/);
  assert.doesNotMatch(source,/function nextFor\(/);
  assert.doesNotMatch(source,/const actionName =/);
  assert.match(source,/\['submissions','pay-run-setup','payment-instructions','exceptions'\]/);
});
