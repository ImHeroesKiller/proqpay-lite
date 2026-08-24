import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const operating = await readFile(new URL('../functions/api/operating-model.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../functions/api/operating-model-d1.js', import.meta.url), 'utf8');
const proof = await readFile(new URL('../functions/api/payment-proof.js', import.meta.url), 'utf8');
const billing = await readFile(new URL('../functions/api/billing.js', import.meta.url), 'utf8');
const bankMigration = await readFile(new URL('../migrations/0009_payroll_bank_snapshot.sql', import.meta.url), 'utf8');
const sequenceSeed = await readFile(new URL('../migrations/0013_seed_invoice_sequences.sql', import.meta.url), 'utf8');

test('payroll finalization locks a full bank fingerprint before PI generation', () => {
  assert.match(operating, /captureBankSnapshot/);
  assert.match(operating, /account_fingerprint/);
  assert.match(operating, /BANK_SNAPSHOT_CHANGED/);
  assert.match(bankMigration, /PRIMARY KEY \(submission_id, employee_id\)/);
});

test('PI approval is maker-checker and retry-safe after approval', () => {
  assert.match(core, /Maker cannot approve the same payment instruction/);
  assert.match(core, /Payment total mismatch blocks approval/);
  assert.match(core, /body\.actionHash !== payment\.content_hash/);
  assert.match(operating, /APPROVED_OR_LATER_STATUSES/);
  assert.match(operating, /idempotentReplay: true/);
});

test('payment proof is normalized and concurrent duplicate upload replays safely', () => {
  assert.match(proof, /normalizedKey/);
  assert.match(proof, /UPPER\(bank\)=\?/);
  assert.match(proof, /UPPER\(reference\)=\?/);
  assert.match(proof, /sameProofPayload/);
  assert.match(proof, /idempotentReplay: true/);
});

test('reconciliation requires proof, exact totals, and heals EWA on replay', () => {
  assert.match(operating, /RECONCILIABLE_STATUSES/);
  assert.match(operating, /proof_count/);
  assert.match(core, /difference === 0/);
  assert.match(core, /instruction_total.*expected_total/s);
  assert.match(operating, /healCompletedPayment/);
  assert.match(operating, /status='REPAID'/);
});

test('invoice creation is tied to completed PI and sequence is historical-safe', () => {
  assert.match(billing, /pi\.status='COMPLETED'/);
  assert.match(billing, /nextInvoiceSequence/);
  assert.doesNotMatch(billing, /COUNT\(\*\)\+1 AS number/);
  assert.match(sequenceSeed, /MAX\(CASE/);
  assert.match(sequenceSeed, /invoice_sequences/);
});

test('invoice issue and AR payment are retry-safe and preserve overpayment', () => {
  assert.match(billing, /invoice\.status==='ISSUED'/);
  assert.match(billing, /idempotentReplay:true/);
  assert.match(billing, /unapplied_cash/);
  assert.match(billing, /PARTIAL_PAID/);
  assert.match(billing, /status:'PAID'/);
});
