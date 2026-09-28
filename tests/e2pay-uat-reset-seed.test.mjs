import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('E2Pay reset purge is tightly scoped to dedicated UAT namespace',async()=>{
  const sql=await read('migrations/0046_reset_e2pay_uat_dummy_data.sql');
  assert.match(sql,/SUB-E2PAY-UAT-%/);
  assert.match(sql,/CLI-E2PAY-UAT-%/);
  assert.match(sql,/EMP-E2PAY-UAT-%/);
  assert.match(sql,/payment_gateway_items/);
  assert.match(sql,/payment_gateway_transactions/);
  assert.match(sql,/payment_gateway_events/);
  assert.match(sql,/hosted_payment_sessions/);
  assert.match(sql,/payment_approvals/);
  assert.match(sql,/payment_instruction_lines/);
  assert.match(sql,/payment_instructions/);
  assert.match(sql,/payroll_submissions/);
  assert.match(sql,/ewa_requests/);
  assert.match(sql,/employee_master_history/);
  assert.match(sql,/payroll_intake_missing_resolutions/);
  assert.match(sql,/payroll_upload_batches/);
  assert.match(sql,/portal_settings/);
  assert.doesNotMatch(sql,/CREATE TEMP TABLE/);
  assert.match(sql,/CREATE TABLE _e2pay_uat_submissions/);
  assert.match(sql,/DROP TABLE IF EXISTS _e2pay_uat_submissions/);
  assert.doesNotMatch(sql,/DELETE FROM clients\s*;/);
  assert.doesNotMatch(sql,/DELETE FROM employees\s*;/);
  assert.doesNotMatch(sql,/DELETE FROM payroll_submissions\s*;/);
});

test('fresh E2Pay UAT seed contains complete isolated master and payroll data',async()=>{
  const sql=await read('ops/e2pay-uat-fresh-seed.sql');
  assert.match(sql,/CLI-E2PAY-UAT-FRESH/);
  assert.match(sql,/PRJ-E2PAY-UAT-FRESH/);
  assert.match(sql,/SP-E2PAY-UAT-FRESH/);
  assert.match(sql,/SUB-E2PAY-UAT-FRESH-001/);
  for(let i=1;i<=5;i++){
    assert.match(sql,new RegExp(`EMP-E2PAY-UAT-00${i}`));
  }
  assert.match(sql,/15000/);
  assert.match(sql,/25000/);
  assert.match(sql,/35000/);
  assert.match(sql,/45000/);
  assert.match(sql,/55000/);
  assert.match(sql,/CLIENT_APPROVED/);
  assert.match(sql,/MASTER_CURRENT/);
  assert.match(sql,/No PI, payment approval, gateway transaction, or provider payment was pre-created/);
});

test('fresh UAT seed is remote-only and does not bypass final payment authority',async()=>{
  const sql=await read('ops/e2pay-uat-fresh-seed.sql');
  const workflow=await read('.github/workflows/cloudflare-deploy.yml');
  assert.doesNotMatch(sql,/INSERT INTO payment_instructions/i);
  assert.doesNotMatch(sql,/INSERT INTO payment_approvals/i);
  assert.doesNotMatch(sql,/INSERT INTO payment_gateway_transactions/i);
  assert.doesNotMatch(sql,/APPROVED_FOR_PAYMENT/);
  assert.doesNotMatch(sql,/UAT-CONTROLLER-/);
  assert.match(workflow,/Seed fresh isolated E2Pay UAT dataset/);
  assert.match(workflow,/--file=ops\/e2pay-uat-fresh-seed\.sql/);
});

test('UAT provider destination safety remains enforced independently of dummy master bank data',async()=>{
  const safety=await read('tests/e2pay-uat-dummy.test.mjs');
  const provider=await read('functions/api/payment-gateway-e2pay.js');
  assert.match(safety,/701075327/);
  assert.match(safety,/bankId:'permata'/);
  assert.match(provider,/E2PAY_UAT_DUMMY_DESTINATION/);
});


test('E2Pay UAT employees never receive employee portal credentials',async()=>{
  const seed=await read('scripts/seed-employee-portal-passwords.mjs');
  assert.match(seed,/e\.id NOT LIKE 'EMP-E2PAY-UAT-%'/);
});


test('fresh UAT seed includes canonical Pay Run and immutable bank snapshots',async()=>{
  const sql=await read('ops/e2pay-uat-fresh-seed.sql');
  assert.match(sql,/INSERT OR IGNORE INTO payroll_run_lines/);
  assert.match(sql,/INSERT OR IGNORE INTO payroll_bank_snapshots/);
  assert.match(sql,/PRL-E2PAY-UAT-001/);
  assert.match(sql,/SUB-E2PAY-UAT-FRESH-001/);
  assert.match(sql,/ad80d5580ceae56e56a1bb6980fddc39d4b188969fe1368a2b7141687f8734b0/);
  assert.match(sql,/8086dcb8092196821ee0b94da2519d835ca7beed4fcc1de554ca6c1765e1d9f4/);
  assert.match(sql,/55eaeb6e906bfa39ff29bcfa93bf9e98f72376829e019dc832c477f0621f13dd/);
  assert.match(sql,/60b8b701913589c1c49ffabb912e50de61eff2b5c2537f62f7d079f6d42f4bfd/);
  assert.match(sql,/0aead901b752f7132e8dcdd73cba52401c4a1694ed63f1acc843029b3e2a361d/);
  assert.match(sql,/E2PAY_UAT_CANONICAL_BANK_SNAPSHOT_SEEDED/);
});
