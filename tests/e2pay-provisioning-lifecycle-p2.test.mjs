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
  assert.match(api,/readiness:\{ready:provisioned&&merchantCredential\.ready/);
  assert.match(api,/PROVISIONING_INCOMPLETE/);
  assert.match(api,/MERCHANT_CREDENTIAL_REQUIRED/);
  assert.match(ui,/Readiness/);
  assert.match(ui,/Provisioning gagal/);
  assert.match(ui,/Menunggu konfirmasi E2Pay/);
});

test('GT5 master-only routing never falls back to deleted project/client subaccount',()=>{
  assert.match(routing,/account_scope='MASTER'/);
  assert.match(routing,/master\?\.status==='ACTIVE'/);
  assert.doesNotMatch(routing,/account_scope='SUB_ACCOUNT'/);
});
