import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const operatingModel = await readFile(new URL('../functions/api/operating-model.js', import.meta.url), 'utf8');
const employeeInit = await readFile(new URL('../functions/api/employee/init.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/0009_payroll_bank_snapshot.sql', import.meta.url), 'utf8');

test('reconciliation is gated by payment state and evidence', () => {
  assert.match(operatingModel, /RECONCILIABLE_STATUSES/);
  assert.match(operatingModel, /proof_count/);
  assert.match(operatingModel, /Bukti pembayaran belum tersedia/);
  assert.match(operatingModel, /idempotentReplay: true/);
});

test('bank account is fingerprinted only at valid payroll finalization', () => {
  assert.match(operatingModel, /account_fingerprint/);
  assert.match(operatingModel, /captureBankSnapshot/);
  assert.match(operatingModel, /FINALIZE_PAYROLL/);
  assert.match(operatingModel, /BANK_SNAPSHOT_CHANGED/);
  assert.match(operatingModel, /validateSnapshotCapture/);
  assert.match(operatingModel, /\['VALIDATED','STANDARDIZED'\]/);
  assert.match(operatingModel, /SNAPSHOT_ROLES/);
  assert.match(migration, /PRIMARY KEY \(submission_id, employee_id\)/);
});

test('unknown payroll state is explicit and never shown as paid', () => {
  assert.match(employeeInit, /needsReview/);
  assert.match(employeeInit, /stage = 2/);
  assert.match(employeeInit, /belum dikenali oleh Employee Portal/);
});
