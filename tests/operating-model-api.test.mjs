import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition, instructionTotal, resolveTierTransition, validateOperatingAction,
} from '../functions/api/operating-model-validation.js';
import { permissionsFor } from '../functions/api/_security.js';

test('managed payroll roles receive scoped permissions', () => {
  assert.equal(permissionsFor('PAYROLL_PROCESSOR').includes('payment:approve'), false);
  assert.equal(permissionsFor('PAYROLL_CONTROLLER').includes('payment:approve'), false);
  assert.equal(permissionsFor('SUPER_ADMIN').includes('PAYMENT_APPROVER'), true);
  const granted = permissionsFor('PAYROLL_CONTROLLER', 'controller@proqpay.id', {
    ROLE_MAP_JSON: JSON.stringify({
      'controller@proqpay.id': { role: 'PAYROLL_CONTROLLER', permissions: ['PAYMENT_APPROVER'] },
    }),
  });
  assert.equal(granted.includes('payment:approve'), true);
  assert.equal(permissionsFor('CLIENT_USER').includes('exception:respond'), true);
});

test('submission transition registry rejects skipped workflow states', () => {
  assert.equal(canTransition('DRAFT', 'SUBMITTED'), true);
  assert.equal(canTransition('DRAFT', 'DATA_APPROVED'), false);
  assert.equal(canTransition('CLIENT_ACTION_REQUIRED', 'CLIENT_RESUBMITTED'), true);
  assert.equal(canTransition('SUBMITTED', 'AI_VALIDATING'), true);
  assert.equal(canTransition('DATA_APPROVED', 'PAYMENT_INSTRUCTION_READY'), true);
  assert.equal(validateOperatingAction({ action: 'TRANSITION_SUBMISSION', submissionId: 'SUB-1', toState: 'CONTROLLER_REVIEW', reviewConfirmed: true, reviewNote: 'Sudah diperiksa' }).ok, true);
  assert.equal(validateOperatingAction({ action: 'UPDATE_SUBMISSION_PERIODS', submissionId: 'SUB-1', paymentPeriod: '2026-08', arrearsPeriods: ['2026-05','2026-06'] }).ok, true);
  assert.equal(validateOperatingAction({ action: 'UPDATE_SUBMISSION_PERIODS', submissionId: 'SUB-1', paymentPeriod: 'Agustus', arrearsPeriods: [] }).ok, false);
  assert.equal(resolveTierTransition('TIER_1_PAYMENT_PROCESSING', 'SUBMITTED', 'INGESTING'), 'AI_VALIDATING');
  assert.equal(resolveTierTransition('TIER_1_PAYMENT_PROCESSING', 'DATA_APPROVED', 'PAYROLL_FINALIZED'), 'PAYMENT_INSTRUCTION_READY');
  assert.equal(resolveTierTransition('TIER_2_MANAGED_PAYROLL', 'DATA_APPROVED', 'PAYROLL_FINALIZED'), 'PAYROLL_FINALIZED');
  assert.equal(validateOperatingAction({ action: 'GENERATE_PAYMENT_INSTRUCTION', submissionId: 'SUB-1' }).ok, true);
});

test('payment instruction requires exact deterministic total', () => {
  const input = {
    action: 'CREATE_PAYMENT_INSTRUCTION',
    clientId: 'CLI-039',
    idempotencyKey: 'PI-2025-10-V1',
    expectedTotal: 300,
    lines: [
      { beneficiaryName: 'Ani', bankName: 'BCA', maskedAccount: '****1234', amount: 100 },
      { beneficiaryName: 'Budi', bankName: 'BRI', maskedAccount: '****5678', amount: 200 },
    ],
  };
  assert.equal(validateOperatingAction(input).ok, true);
  assert.equal(instructionTotal(input.lines), input.expectedTotal);
  const invalid = validateOperatingAction({ ...input, expectedTotal: 301 });
  assert.equal(invalid.ok, true);
  assert.notEqual(instructionTotal(input.lines), 301);
});

test('payment approval requires an exact confirmation contract', () => {
  const valid = validateOperatingAction({
    action: 'APPROVE_PAYMENT',
    paymentInstructionId: 'PI-1',
    actionHash: 'HASH-1',
    confirmation: 'KONFIRMASI PAYMENT',
  });
  assert.equal(valid.ok, true);
  const invalid = validateOperatingAction({
    action: 'APPROVE_PAYMENT',
    paymentInstructionId: 'PI-1',
    actionHash: 'HASH-1',
    confirmation: 'iya',
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(' '), /KONFIRMASI PAYMENT/);
});

test('service plan and exception payloads validate required business fields', () => {
  assert.equal(validateOperatingAction({
    action: 'CREATE_SERVICE_PLAN',
    clientId: 'CLI-039',
    tier: 'TIER_2_MANAGED_PAYROLL',
    effectiveFrom: '2026-08-10',
  }).ok, true);
  assert.equal(validateOperatingAction({
    action: 'CREATE_EXCEPTION',
    submissionId: 'SUB-1',
    category: 'BANK_ACCOUNT',
    severity: 'CRITICAL',
  }).ok, true);
  assert.equal(validateOperatingAction({
    action: 'CREATE_VALIDATION_BATCH', submissionId: 'SUB-1',
    issues: [{ category: 'BANK_MISSING', severity: 'CRITICAL' }],
  }).ok, true);
  assert.equal(validateOperatingAction({
    action: 'REQUEST_CLIENT_ACTION', exceptionId: 'EXC-1', message: 'Mohon lengkapi rekening.',
  }).ok, true);
});

test('proof, reconciliation, and integration actions validate controlled inputs', () => {
  const proof = validateOperatingAction({
    action: 'UPLOAD_PAYMENT_PROOF', paymentInstructionId: 'PI-1', bank: 'BCA',
    reference: 'REF-202607', transactionDate: '2026-07-31', amount: 100000,
    uploadedFileId: 'FILE-1',
  });
  assert.equal(proof.ok, true);
  assert.equal(validateOperatingAction({ action: 'RECONCILE_PAYMENT', paymentInstructionId: 'PI-1' }).ok, true);
  assert.equal(validateOperatingAction({ action: 'CREATE_INTEGRATION', clientId: 'CL-1', servicePlanId: 'SP-1', connectorType: 'HRIS' }).ok, true);
  assert.equal(validateOperatingAction({ action: 'CREATE_INTEGRATION', clientId: 'CL-1', servicePlanId: 'SP-1', connectorType: 'UNKNOWN' }).ok, false);
});
