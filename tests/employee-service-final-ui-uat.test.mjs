import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employee Services final UAT: EWA approvals hand off payments to the canonical payment workspace',async()=>{
  const inbox=await read('src/components/EwaInbox.tsx');
  assert.match(inbox,/Promise<boolean>/);
  assert.match(inbox,/return false/);
  assert.doesNotMatch(inbox,/CanonicalDisbursementWorkspace|disbursementTarget/);
  assert.match(inbox,/paymentPanel=DISBURSEMENT&ewaRequest=/);
  assert.doesNotMatch(inbox,/DisbursementDialog/);
});

test('Employee Services final UAT: admin dialogs and drawers support Escape close',async()=>{
  const payout=await read('src/components/employee-services/DisbursementDialog.tsx');
  const detail=await read('src/components/employee-services/EwaLifecycle.tsx');
  const audit=await read('src/components/SystemLogs.tsx');
  assert.match(payout,/event\.key === "Escape"/);
  assert.match(detail,/event\.key === "Escape"/);
  assert.match(audit,/event\.key === "Escape"/);
});

test('Employee Services final UAT: admin workspace naming is consistent',async()=>{
  const inbox=await read('src/components/EwaInbox.tsx');
  assert.match(inbox,/eyebrow="EMPLOYEE SERVICES"/);
  assert.doesNotMatch(inbox,/page-eyebrow">Employee portal/);
});
