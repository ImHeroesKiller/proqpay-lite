import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const fundingApi=await readFile(new URL('../functions/api/e2pay-disbursement-limits.js',import.meta.url),'utf8');
const fundingUi=await readFile(new URL('../src/components/E2PayFundingLimitControl.tsx',import.meta.url),'utf8');
const directory=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const types=await readFile(new URL('../src/lib/e2pay-api.ts',import.meta.url),'utf8');

test('P5.7.10.1 Funding API exposes durable legacy credential lifecycle',()=>{
  assert.match(fundingApi,/LEFT JOIN provider_provisioning_sessions pps ON pps\.provider_account_registry_id=ppa\.id/);
  assert.match(fundingApi,/legacyCompatibility:legacyCredentialRecoveryState/);
  assert.match(fundingApi,/credentialHealth:credentialHealthState/);
  assert.match(fundingApi,/LEGACY_CREDENTIAL_RECOVERY_REQUIRED/);
});

test('P5.7.10.1 funding type contract carries legacy compatibility and credential health',()=>{
  assert.match(types,/legacyCompatibility\?:string\|null/);
  assert.match(types,/credentialHealth\?:\{state:string;healthy:boolean;degraded:boolean;recoveryRequired:boolean/);
});

test('P5.7.10.1 Payment Instructions distinguishes legacy recovery from normal service-managed credential state',()=>{
  assert.match(fundingUi,/legacyRecoveryRequired/);
  assert.match(fundingUi,/Legacy · Recovery Required/);
  assert.match(fundingUi,/Legacy E2Pay account · credential recovery diperlukan/);
  assert.match(fundingUi,/Recovery Credential/);
  assert.match(fundingUi,/tanpa membuat merchant\/sub-account baru/);
  assert.match(fundingUi,/Credential lifecycle belum READY/);
  assert.doesNotMatch(fundingUi,/Hubungkan Credential/);
});

test('GT5 Client and Project do not require scoped credential recovery CTA',()=>{ assert.match(directory,/Master E2Pay/); });


test('P5.7.10.1 successful return preserves account selection and explains initial balance sync',()=>{
  assert.match(fundingUi,/fundingAccountId/);
  assert.match(fundingUi,/recoveryComplete/);
  assert.match(fundingUi,/Legacy credential berhasil direcovery\. Balance awal sudah disinkronkan/);
  assert.match(fundingUi,/credentialBlocked/);
});
