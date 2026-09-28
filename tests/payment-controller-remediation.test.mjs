import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('E2Pay UAT synthetic approvals are returned to real Controller approval',async()=>{
  const sql=await read('migrations/0043_e2pay_uat_controller_authority.sql');
  assert.match(sql,/SUB-E2PAY-UAT-001/);
  assert.match(sql,/SUB-E2PAY-UAT-005/);
  assert.match(sql,/approver_user_id LIKE 'UAT-CONTROLLER-%'/);
  assert.match(sql,/status='INVALIDATED'/);
  assert.match(sql,/status='PAYMENT_APPROVAL_PENDING'/);
  assert.match(sql,/NOT EXISTS \([\s\S]*payment_gateway_transactions/);
  assert.match(sql,/E2PAY_UAT_SYNTHETIC_APPROVAL_INVALIDATED/);
});

test('invalidated approvals can never satisfy payment approval idempotency',async()=>{
  const d1=await read('functions/api/operating-model-d1.js');
  const edge=await read('functions/api/operating-model.js');
  for(const source of [d1,edge]){
    assert.match(source,/payment_instruction_id=\? AND action_hash=\? AND status='APPROVED' LIMIT 1/);
  }
});

test('special UAT fixture endpoint cannot impersonate a Payroll Controller anymore',async()=>{
  const treeGuard=await read('tests/payment-controller-final-authority.test.mjs');
  assert.match(treeGuard,/PAYROLL_CONTROLLER/);
  await assert.rejects(
    ()=>read('functions/api/e2pay-uat-fixtures.js'),
    /ENOENT|no such file/i,
  );
});
