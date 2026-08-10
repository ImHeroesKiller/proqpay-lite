import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition, instructionTotal, validateOperatingAction,
} from '../functions/api/operating-model-validation.js';
import { permissionsFor } from '../functions/api/_security.js';

test('managed payroll roles receive scoped permissions', () => {
  assert.equal(permissionsFor('PAYROLL_PROCESSOR').includes('payment:approve'), false);
  assert.equal(permissionsFor('PAYROLL_CONTROLLER').includes('payment:approve'), true);
  assert.equal(permissionsFor('CLIENT_USER').includes('exception:respond'), true);
});

test('submission transition registry rejects skipped workflow states', () => {
  assert.equal(canTransition('DRAFT', 'SUBMITTED'), true);
  assert.equal(canTransition('DRAFT', 'DATA_APPROVED'), false);
  assert.equal(canTransition('CLIENT_ACTION_REQUIRED', 'CLIENT_RESUBMITTED'), true);
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
});
