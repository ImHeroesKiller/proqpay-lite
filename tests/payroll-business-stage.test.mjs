import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAYROLL_BUSINESS_STAGE_COUNT, payrollBusinessStage, payrollBusinessStageIndex, payrollBusinessStageLabel,
} from '../src/lib/payroll-business-stage.ts';

test('technical payroll states collapse into five user-facing business stages', () => {
  assert.equal(PAYROLL_BUSINESS_STAGE_COUNT, 5);
  assert.equal(payrollBusinessStage('DRAFT'), 'DATA_READINESS');
  assert.equal(payrollBusinessStage('AI_VALIDATING'), 'PAYROLL_PREPARATION');
  assert.equal(payrollBusinessStage('PROCESSOR_REVIEW'), 'PAYROLL_PREPARATION');
  assert.equal(payrollBusinessStage('CONTROLLER_REVIEW'), 'REVIEW_APPROVAL');
  assert.equal(payrollBusinessStage('PAYMENT_APPROVAL_PENDING'), 'PAYMENT');
  assert.equal(payrollBusinessStage('COMPLETED'), 'RECONCILIATION_CLOSE');
  assert.equal(payrollBusinessStageLabel('RECONCILIATION'), 'Reconciliation & Close');
  assert.equal(payrollBusinessStageIndex('DRAFT'), 1);
  assert.equal(payrollBusinessStageIndex('COMPLETED'), 5);
  assert.equal(payrollBusinessStageIndex('DRAFT', 'PAID', null), 5);
});
