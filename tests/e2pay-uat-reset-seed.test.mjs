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
  assert.doesNotMatch(sql,/DELETE FROM clients\s*;/);
  assert.doesNotMatch(sql,/DELETE FROM employees\s*;/);
  assert.doesNotMatch(sql,/DELETE FROM payroll_submissions\s*;/);
});

test('fresh E2Pay UAT seed contains complete isolated master and payroll data',async()=>{
  const sql=await read('migrations/0047_seed_fresh_e2pay_uat_dataset.sql');
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

test('fresh UAT seed does not bypass final payment authority',async()=>{
  const sql=await read('migrations/0047_seed_fresh_e2pay_uat_dataset.sql');
  assert.doesNotMatch(sql,/INSERT INTO payment_instructions/i);
  assert.doesNotMatch(sql,/INSERT INTO payment_approvals/i);
  assert.doesNotMatch(sql,/INSERT INTO payment_gateway_transactions/i);
  assert.doesNotMatch(sql,/APPROVED_FOR_PAYMENT/);
  assert.doesNotMatch(sql,/UAT-CONTROLLER-/);
});

test('UAT provider destination safety remains enforced independently of dummy master bank data',async()=>{
  const safety=await read('tests/e2pay-uat-dummy.test.mjs');
  const provider=await read('functions/api/payment-gateway-e2pay.js');
  assert.match(safety,/701075327/);
  assert.match(safety,/bankId:'permata'/);
  assert.match(provider,/E2PAY_UAT_DUMMY_DESTINATION/);
});
