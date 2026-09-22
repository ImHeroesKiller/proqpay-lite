import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAYROLL_BUSINESS_STAGE_COUNT, payrollBusinessStage, payrollBusinessStageIndex, payrollBusinessStageLabel,
} from '../src/lib/payroll-business-stage.ts';

test('technical payroll states collapse into Prepare Review Approve Pay Close', () => {
  assert.equal(PAYROLL_BUSINESS_STAGE_COUNT, 5);
  assert.equal(payrollBusinessStage('DRAFT'), 'PREPARE');
  assert.equal(payrollBusinessStage('AI_VALIDATING'), 'PREPARE');
  assert.equal(payrollBusinessStage('PROCESSOR_REVIEW'), 'REVIEW');
  assert.equal(payrollBusinessStage('CONTROLLER_REVIEW'), 'APPROVE');
  assert.equal(payrollBusinessStage('PAYMENT_APPROVAL_PENDING'), 'PAY');
  assert.equal(payrollBusinessStage('COMPLETED'), 'CLOSE');
  assert.equal(payrollBusinessStageLabel('RECONCILIATION'), 'Close');
  assert.equal(payrollBusinessStageIndex('DRAFT'), 1);
  assert.equal(payrollBusinessStageIndex('COMPLETED'), 5);
  assert.equal(payrollBusinessStageIndex('DRAFT', 'PAID', null), 5);
});
