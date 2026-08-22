import assert from 'node:assert/strict';
import test from 'node:test';
import { payrollBusinessStage, payrollBusinessStageLabel } from '../src/lib/payroll-business-stage.ts';

test('technical payroll states collapse into five user-facing business stages',()=>{
  assert.equal(payrollBusinessStage('DRAFT'),'DATA_READINESS');
  assert.equal(payrollBusinessStage('AI_VALIDATING'),'PAYROLL_PREPARATION');
  assert.equal(payrollBusinessStage('CONTROLLER_REVIEW'),'REVIEW_APPROVAL');
  assert.equal(payrollBusinessStage('PAYMENT_APPROVAL_PENDING'),'PAYMENT');
  assert.equal(payrollBusinessStage('COMPLETED'),'RECONCILIATION_CLOSE');
  assert.equal(payrollBusinessStageLabel('RECONCILIATION'),'Reconciliation & Close');
});
