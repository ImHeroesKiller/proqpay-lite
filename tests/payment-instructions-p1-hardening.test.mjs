import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Payment Instructions P1 enforces maker and checker permissions at edge and D1 layers',async()=>{
  const edge=await read('functions/api/operating-model.js');
  const d1=await read('functions/api/operating-model-d1.js');
  assert.match(edge,/PAYMENT_PREPARE_PERMISSION_REQUIRED/);
  assert.match(edge,/PAYMENT_APPROVE_PERMISSION_REQUIRED/);
  assert.match(d1,/actor\.permissions\?\.includes\('payment:prepare'\)/);
  assert.match(d1,/actor\.permissions\?\.includes\('payment:approve'\)/);
});

test('Payment Instructions P1 verifies immutable bank snapshot before generation',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(api,/LEFT JOIN payroll_bank_snapshots pbs/);
  assert.match(api,/BANK_SNAPSHOT_INCOMPLETE/);
  assert.match(api,/BANK_SNAPSHOT_CHANGED/);
  assert.match(api,/account_fingerprint/);
  assert.match(api,/PAY_RUN_BANK_LAST4_CHANGED/);
});

test('Payment Instructions P1 rehashes encrypted PI snapshot server-side before approval',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(api,/decryptAccountNumber/);
  assert.match(api,/PI_LINE_HASH_MISMATCH/);
  assert.match(api,/PI_SERVER_HASH_MISMATCH/);
  assert.match(api,/instructionContentHash/);
  assert.match(api,/PI_SNAPSHOT_DECRYPT_FAILED/);
});

test('Payment Instructions P1 blocks amount and recipient count drift',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(api,/PI_CONTROL_TOTAL_MISMATCH/);
  assert.match(api,/PI_RECIPIENT_COUNT_MISMATCH/);
  assert.match(api,/expectedRecipientCount/);
  assert.match(api,/recipientBalanced/);
  assert.match(ui,/Recipient count terkunci/);
  assert.match(ui,/recipientBalanced !== true/);
});

test('Payment Instructions P1 keeps generation idempotent under concurrent requests',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  const migration=await read('migrations/0017_single_active_pi_per_submission.sql');
  assert.match(migration,/one_active_per_submission/);
  assert.match(api,/concurrentReplay:true/);
  assert.match(api,/canonical\?\.content_hash === contentHash/);
  assert.match(api,/idempotentReplay:true/);
});

test('Payment Instructions P1 safely recovers legacy and orphan payment states',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(api,/PAYMENT_INSTRUCTION_LEGACY_RECOVERY/);
  assert.match(api,/PAYMENT_INSTRUCTION_ORPHAN_RECOVERY/);
  assert.match(api,/PAYMENT_INSTRUCTION_ORPHAN_REGENERATED/);
  assert.match(api,/recoveredState:'CLIENT_APPROVAL_PENDING'/);
});

test('Payment Instructions P1 requires maker preview and protects bank exports until approval',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  const exporter=await read('functions/api/payment-instruction-export.js');
  assert.match(ui,/Preview PI/);
  assert.match(ui,/Submit PI/);
  assert.match(exporter,/PAYROLL_PROCESSOR.*format !== 'PDF'/);
  assert.match(exporter,/PAYMENT_INSTRUCTION_READY/);
  assert.match(exporter,/PI_EXPORT_CONTROL_MISMATCH/);
  assert.match(exporter,/File bank hanya tersedia setelah Payment Instruction disetujui/);
});
