import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { canonicalReconciliationOutcome, summarizeReconciliationItems } from '../functions/api/disbursement-reconciliation-e2pay.js';

const api=await readFile(new URL('../functions/api/canonical-transaction-register.js',import.meta.url),'utf8');
const svc=await readFile(new URL('../functions/api/disbursement-reconciliation-e2pay.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/CanonicalTransactionRegister.tsx',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0064_p57_canonical_transaction_register.sql',import.meta.url),'utf8');

test('P5.7.8 reconciliation outcome distinguishes matched, partial, failed and unresolved',()=>{
  let s=summarizeReconciliationItems([{status:'SUCCEEDED',amount:100},{status:'SUCCEEDED',amount:200}]);
  assert.deepEqual(canonicalReconciliationOutcome(s),{attemptStatus:'MATCHED',executionStatus:'SUCCEEDED',requestStatus:'RECONCILED'});
  s=summarizeReconciliationItems([{status:'SUCCEEDED',amount:100},{status:'FAILED',amount:200}]);
  assert.deepEqual(canonicalReconciliationOutcome(s),{attemptStatus:'PARTIAL',executionStatus:'FAILED',requestStatus:'PARTIALLY_SETTLED'});
  assert.equal(s.settledAmount,100); assert.equal(s.failedAmount,200);
  s=summarizeReconciliationItems([{status:'FAILED',amount:100},{status:'FAILED',amount:200}]);
  assert.equal(canonicalReconciliationOutcome(s).requestStatus,'FAILED');
  s=summarizeReconciliationItems([{status:'SUCCEEDED',amount:100},{status:'UNKNOWN',amount:200}]);
  assert.equal(canonicalReconciliationOutcome(s).requestStatus,'RECONCILIATION_REQUIRED');
});

test('P5.7.8 provider reconciliation uses stable clientRef transaction history only',()=>{
  assert.match(svc,/e2payTransactionHistory\(env,auth\.accessToken,item\.client_ref\)/);
  assert.doesNotMatch(svc,/account_number|beneficiary_name.*history|amount.*history/);
  assert.match(svc,/normalized==='PENDING'\?'UNKNOWN':normalized/);
});

test('P5.7.8 canonical transaction register view spans DR execution and reconciliation',()=>{
  const db=new D1Mock();
  const view=db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='canonical_transaction_register'").get();
  assert.equal(view.name,'canonical_transaction_register');
  const cols=db.sqlite.prepare('PRAGMA table_info(canonical_transaction_register)').all().map(r=>r.name);
  for(const col of ['purpose','destination_mode','source_document_type','execution_status','reconciliation_status','settled_amount','failed_amount','unresolved_items']) assert.ok(cols.includes(col),col);
  assert.match(migration,/disbursement_reconciliation_attempts/);
});

test('P5.7.8 reconciliation API enforces Controller + MFA and adjusts funding by final outcome',()=>{
  assert.match(api,/PAYROLL_CONTROLLER/);
  assert.match(api,/reconciliation:write/);
  assert.match(api,/MFA_STEP_UP_REQUIRED/);
  assert.match(api,/consumeDisbursementRequestLimit/);
  assert.match(api,/releaseDisbursementRequestLimit/);
  assert.match(api,/PARTIAL/);
  assert.match(api,/RECONCILIATION_CONFIRMED_ALL_FAILED/);
});

test('P5.7.8 register output is masked and has no beneficiary ciphertext fields',()=>{
  assert.match(api,/providerSubAccountIdMasked/);
  assert.doesNotMatch(api,/account_number_ciphertext|account_number_iv|account_number_hash/);
  assert.match(ui,/Payroll Direct · Corporate · EWA/);
  assert.match(ui,/Reconcile Provider/);
});

test('P5.7.8 migration preserves immutable beneficiary financial snapshot while allowing operational status updates',()=>{
  assert.match(migration,/DROP TRIGGER IF EXISTS disbursement_item_snapshot_immutable_ready/);
  assert.match(migration,/BEFORE UPDATE OF[\s\S]*account_number_ciphertext[\s\S]*client_reference/);
  const triggerSection=migration.slice(migration.indexOf('CREATE TRIGGER IF NOT EXISTS disbursement_item_snapshot_immutable_ready'));
  assert.doesNotMatch(triggerSection,/provider_status,status,error_code,error_message/);
});
