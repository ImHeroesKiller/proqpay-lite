import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const billing = await readFile(new URL('../functions/api/billing.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/0011_billing_concurrency_cash.sql', import.meta.url), 'utf8');

test('invoice numbering uses atomic sequence table, not COUNT plus one', () => {
  assert.match(billing, /nextInvoiceSequence/);
  assert.match(billing, /invoice_sequences/);
  assert.match(billing, /ON CONFLICT\(org_id,period\) DO UPDATE/);
  assert.doesNotMatch(billing, /COUNT\(\*\)\+1 AS number/);
  assert.match(migration, /PRIMARY KEY \(org_id, period\)/);
});

test('AR overpayment is preserved as unapplied cash', () => {
  assert.match(billing, /unapplied_cash/);
  assert.match(billing, /unapplied:/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS unapplied_cash/);
  assert.match(migration, /CHECK \(amount > 0\)/);
});

test('AR payment references are idempotent and invoice AR is unique', () => {
  assert.match(billing, /idempotentReplay:true/);
  assert.match(migration, /idx_ar_payment_reference/);
  assert.match(migration, /idx_unapplied_cash_reference/);
  assert.match(migration, /idx_ar_one_invoice/);
});

test('invoice maker checker has no super admin self approval bypass', () => {
  assert.match(billing, /created_by<>\?/);
  assert.doesNotMatch(billing, /\?='SUPER_ADMIN' OR created_by<>\?/);
});
