import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  decryptProviderAccountCredential,
  encryptProviderAccountCredential,
  providerAccountCredentialState,
  scopedE2PayRuntimeEnv,
} from '../functions/api/payment-provider-account-credentials.js';

const api=await readFile(new URL('../functions/api/e2pay-subaccounts.js',import.meta.url),'utf8');
const gateway=await readFile(new URL('../functions/api/payment-gateway.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');

const env={
  E2PAY_CREDENTIALS_KEY:'p5-5-test-key-with-at-least-32-characters',
  E2PAY_CLIENT_ID:'host-client',
  E2PAY_CLIENT_SECRET:'host-secret',
  E2PAY_SOURCE_ID:'MANDIRISG',
};

test('P5.5 encrypts merchant credential per provider account and restores only scoped login material',async()=>{
  const merchantCredential=await encryptProviderAccountCredential(env,{
    username:'081200000001',
    passwordMd5:'A'.repeat(32),
  });
  const row={
    provider_sub_account_id:'SUB-ACCOUNT-0001',
    metadata_json:JSON.stringify({merchantCredential}),
  };
  assert.equal(providerAccountCredentialState(row).ready,true);
  const decrypted=await decryptProviderAccountCredential(env,row);
  assert.deepEqual(decrypted,{username:'081200000001',passwordMd5:'A'.repeat(32)});

  const scoped=await scopedE2PayRuntimeEnv(null,env,row);
  assert.equal(scoped.E2PAY_USERNAME,'081200000001');
  assert.equal(scoped.E2PAY_PASSWORD_MD5,'A'.repeat(32));
  assert.equal(scoped.E2PAY_ACCOUNT_SRC,'SUB-ACCOUNT-0001');
  assert.equal(scoped.E2PAY_SOURCE_MODE,'SUB_ACCOUNT_SNAPSHOT');
  assert.equal(scoped.E2PAY_CLIENT_ID,'host-client');
});

test('P5.5 public state exposes readiness but never plaintext merchant credential',()=>{
  assert.match(api,/merchantCredential:providerAccountCredentialState|merchantCredential,/);
  assert.match(api,/BIND_SUBACCOUNT_CREDENTIAL/);
  assert.match(api,/E2PAY_SUBACCOUNT_CREDENTIAL_ACCOUNT_MISMATCH/);
  assert.match(api,/scopedE2PayRuntimeEnv\(env\.DB,runtimeEnv,current\)/);
  assert.doesNotMatch(api,/passwordPlain|plaintextPassword/);
});

test('P5.5 payment execution, reconciliation and failed verification use scoped merchant runtime',()=>{
  assert.match(gateway,/scopedE2PayRuntimeEnv\(database,runtimeEnv,providerAccount\)/);
  assert.match(gateway,/env:routedRuntimeEnv/);
  assert.match(gateway,/payment\.provider_account_registry_id/);
  assert.match(gateway,/E2PAY_SUBACCOUNT_CREDENTIAL_REQUIRED/);
});

test('P5.5 client UI requires credential validation and enables balance synchronization',()=>{
  assert.match(ui,/Validasi & Simpan Credential/);
  assert.match(ui,/Sync Balance/);
  assert.match(ui,/Scoped & encrypted/);
  assert.match(ui,/Password plaintext tidak disimpan/);
});
