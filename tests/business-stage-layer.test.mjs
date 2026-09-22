import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BUSINESS_STAGE_META,
  PAYROLL_BUSINESS_STAGE_ORDER,
  derivePayrollBusinessStage,
  payrollBusinessStage,
  payrollBusinessStageIndex,
} from '../src/lib/payroll-business-stage-core.js';

test('business stage layer exposes exactly Prepare Review Approve Pay Close', () => {
  assert.deepEqual(PAYROLL_BUSINESS_STAGE_ORDER, ['PREPARE','REVIEW','APPROVE','PAY','CLOSE']);
  assert.deepEqual(PAYROLL_BUSINESS_STAGE_ORDER.map((stage)=>BUSINESS_STAGE_META[stage].label),
    ['Prepare','Review','Approve','Pay','Close']);
});

test('technical payroll states map deterministically to the five business stages', () => {
  const cases = {
    DRAFT:'PREPARE',
    SUBMITTED:'PREPARE',
    INGESTING:'PREPARE',
    AI_VALIDATING:'PREPARE',
    EXCEPTION_FOUND:'REVIEW',
    CLIENT_ACTION_REQUIRED:'REVIEW',
    CLIENT_RESUBMITTED:'REVIEW',
    VALIDATED:'REVIEW',
    STANDARDIZED:'REVIEW',
    CALCULATED:'REVIEW',
    PROCESSOR_REVIEW:'REVIEW',
    REVISION_REQUIRED:'REVIEW',
    CONTROLLER_REVIEW:'APPROVE',
    DATA_APPROVED:'APPROVE',
    PAYROLL_FINALIZED:'APPROVE',
    CLIENT_APPROVAL_PENDING:'APPROVE',
    CLIENT_APPROVED:'APPROVE',
    CLIENT_REVISION_REQUESTED:'APPROVE',
    PAYMENT_INSTRUCTION_READY:'PAY',
    PAYMENT_APPROVAL_PENDING:'PAY',
    APPROVED_FOR_PAYMENT:'PAY',
    DISBURSEMENT_PROCESSING:'PAY',
    PROOF_UPLOADED:'PAY',
    RECONCILIATION:'CLOSE',
    PAYMENT_EXCEPTION:'CLOSE',
    MATCHED:'CLOSE',
    COMPLETED:'CLOSE',
    CLOSED:'CLOSE',
  };
  for (const [state, expected] of Object.entries(cases)) {
    assert.equal(payrollBusinessStage(state), expected, state);
  }
});

test('downstream payment and reconciliation evidence overrides an older submission state', () => {
  let result = derivePayrollBusinessStage({
    state:'CONTROLLER_REVIEW',
    paymentInstructionStatus:'DISBURSEMENT_PROCESSING',
  });
  assert.equal(result.stage,'PAY');
  assert.equal(result.source,'payment_instruction');

  result = derivePayrollBusinessStage({
    state:'CONTROLLER_REVIEW',
    paymentInstructionStatus:'APPROVED_FOR_PAYMENT',
    reconciliationStatus:'MATCHED',
  });
  assert.equal(result.stage,'CLOSE');
  assert.equal(result.source,'reconciliation');
  assert.equal(result.isTerminal,true);
});

test('business status highlights action required and approval without exposing role logic', () => {
  assert.equal(derivePayrollBusinessStage({
    state:'EXCEPTION_FOUND',blockingCount:3,
  }).status,'ACTION_REQUIRED');
  assert.equal(derivePayrollBusinessStage({
    state:'CONTROLLER_REVIEW',
  }).status,'FOR_APPROVAL');
  assert.equal(derivePayrollBusinessStage({
    state:'PAYMENT_APPROVAL_PENDING',
  }).status,'FOR_APPROVAL');
  assert.equal(derivePayrollBusinessStage({
    state:'DISBURSEMENT_PROCESSING',
  }).status,'PROCESSING');
});

test('unknown workflow states fail visible instead of silently looking healthy', () => {
  const result = derivePayrollBusinessStage({ state:'SOME_NEW_UNMAPPED_STATE' });
  assert.equal(result.stage,'PREPARE');
  assert.equal(result.knownState,false);
  assert.equal(result.status,'ACTION_REQUIRED');
  assert.match(result.reason,/Unknown technical state/);
});

test('business stage index remains stable at one through five', () => {
  assert.equal(payrollBusinessStageIndex('DRAFT'),1);
  assert.equal(payrollBusinessStageIndex('EXCEPTION_FOUND'),2);
  assert.equal(payrollBusinessStageIndex('CONTROLLER_REVIEW'),3);
  assert.equal(payrollBusinessStageIndex('APPROVED_FOR_PAYMENT'),4);
  assert.equal(payrollBusinessStageIndex('RECONCILIATION'),5);
});

test('Control Tower and Pay Run detail consume the canonical mapper instead of duplicate pipeline maps', async () => {
  const tower = await readFile(new URL('../src/components/PayrollControlTower.tsx', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/components/OperatingWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(tower,/derivePayrollBusinessStage/);
  assert.match(tower,/PAYROLL_BUSINESS_STAGE_ORDER/);
  assert.doesNotMatch(tower,/label:'Data Readiness'.*label:'Payroll Processing'/s);
  assert.match(workspace,/derivePayrollBusinessStage/);
  assert.match(workspace,/PAYROLL_BUSINESS_STAGE_ORDER\.map/);
  assert.doesNotMatch(workspace,/const flowStates=\['Data Readiness','Payroll Processing'/);
});

test('PI ready is not misreported as awaiting approval before submission', async () => {
  const tower = await readFile(new URL('../src/components/PayrollControlTower.tsx', import.meta.url), 'utf8');
  assert.match(tower,/row\.state==='PAYMENT_APPROVAL_PENDING'/);
  assert.doesNotMatch(tower,/\['PAYMENT_APPROVAL_PENDING','PAYMENT_INSTRUCTION_READY'\]\.includes\(row\.state\)/);
});
