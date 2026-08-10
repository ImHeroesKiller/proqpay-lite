import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PAYMENT_PROOF_BYTES,
  paymentProofObjectKey,
  safeProofFilename,
  validatePaymentProofFile,
} from '../functions/api/payment-proof-validation.js';

const file = (type, size, name = 'proof.pdf') => ({
  type, size, name, arrayBuffer: async () => new ArrayBuffer(size),
});

test('payment proof accepts only bounded PDF and images', () => {
  assert.equal(validatePaymentProofFile(file('application/pdf', 1024)).ok, true);
  assert.equal(validatePaymentProofFile(file('image/jpeg', MAX_PAYMENT_PROOF_BYTES)).ok, true);
  assert.equal(validatePaymentProofFile(file('application/zip', 100)).ok, false);
  assert.equal(validatePaymentProofFile(file('image/png', MAX_PAYMENT_PROOF_BYTES + 1)).ok, false);
  assert.equal(validatePaymentProofFile(null).ok, false);
});

test('payment proof object keys are tenant scoped and sanitized', () => {
  const key = paymentProofObjectKey('ORG-1', 'PI-1', '../../Bukti Gaji Juli.pdf', 123, 'uuid-1');
  assert.equal(key, 'ORG-1/PI-1/123-uuid-1-..-..-Bukti-Gaji-Juli.pdf');
  assert.equal(key.includes(' '), false);
  assert.equal(safeProofFilename('a/b\\c.pdf'), 'a-b-c.pdf');
});
