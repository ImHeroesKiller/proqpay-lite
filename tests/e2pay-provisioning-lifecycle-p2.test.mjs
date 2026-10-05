import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const api=await readFile(new URL('../functions/api/e2pay-subaccounts.js',import.meta.url),'utf8');
const routing=await readFile(new URL('../functions/api/payment-provider-routing.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0054_e2pay_provisioning_lifecycle.sql',import.meta.url),'utf8');

test('P2 persists operational provisioning lifecycle without confirmation secrets',()=>{
  assert.match(migration,/PENDING_CONFIRMATION/);
  assert.match(migration,/PROVISIONED/);
  assert.match(migration,/FAILED/);
  assert.match(api,/E2PAY_SUBACCOUNT_REGISTRATION_FAILED/);
  assert.match(api,/retryable:true/);
  assert.doesNotMatch(migration,/password|token/i);
});

test('P2 readiness fails closed until provisioning is active',()=>{
  assert.match(api,/readiness:\{ready:row\.status==='ACTIVE'/);
  assert.match(api,/PROVISIONING_INCOMPLETE/);
  assert.match(ui,/Readiness/);
  assert.match(ui,/Provisioning gagal/);
  assert.match(ui,/Menunggu konfirmasi E2Pay/);
});

test('P2 payment routing prefers explicit project override then client inheritance',()=>{
  assert.match(routing,/if\(projectId\)/);
  assert.match(routing,/project_id=\?/);
  assert.match(routing,/project_id IS NULL/);
  assert.match(routing,/projectId:account\.project_id\|\|null/);
});
