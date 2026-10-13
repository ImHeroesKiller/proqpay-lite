import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { composeProvisioningToken, generateManagedMerchantPassword, provisioningDisplayState } from '../functions/api/e2pay-provisioning-orchestrator.js';

const api=await readFile(new URL('../functions/api/e2pay-subaccounts.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const credentials=await readFile(new URL('../functions/api/payment-provider-account-credentials.js',import.meta.url),'utf8');

test('P5.7.1 managed password satisfies E2Pay policy without user input',()=>{
  for(let index=0;index<20;index++){
    const value=generateManagedMerchantPassword();
    assert.equal(value.length,12);
    assert.match(value,/[A-Z]/);
    assert.match(value,/[a-z]/);
    assert.match(value,/[0-9]/);
    assert.match(value,/[^A-Za-z0-9]/);
  }
});

test('P5.7.1 OTP composer accepts OTP-only and already-prefixed provider tokens',()=>{
  assert.equal(composeProvisioningToken('AbC','1234'),'AbC1234');
  assert.equal(composeProvisioningToken('AbC','abc1234'),'abc1234');
  assert.equal(composeProvisioningToken('AbC',' 12 34 '),'AbC1234');
});

test('P5.7.1 display state is durable and fail-closed for legacy provisioned accounts',()=>{
  assert.equal(provisioningDisplayState({sessionState:'OTP_REQUIRED'}),'OTP_REQUIRED');
  assert.equal(provisioningDisplayState({accountStatus:'ACTIVE',providerSubAccountId:'SUB1',credentialReady:true}),'READY');
  assert.equal(provisioningDisplayState({accountStatus:'ACTIVE',providerSubAccountId:'SUB1',credentialReady:false}),'MANUAL_REVIEW');
});

test('P5.7.1 schema enforces one durable provisioning session per provider registry',()=>{
  const db=new D1Mock();
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-57','MSG','MSG57');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-57','ORG-57','C57','Client 57','ACTIVE');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,account_name,status,created_by)
      VALUES('PPA-57','ORG-57','CLI-57','E2PAY','UAT','SUB_ACCOUNT','Client 57','DRAFT','seed');
    INSERT INTO provider_provisioning_sessions(id,org_id,client_id,provider,environment,provider_account_registry_id,state,created_by)
      VALUES('PPS-1','ORG-57','CLI-57','E2PAY','UAT','PPA-57','OTP_REQUIRED','seed');
  `);
  assert.throws(()=>db.sqlite.exec(`INSERT INTO provider_provisioning_sessions(id,org_id,client_id,provider,environment,provider_account_registry_id,state,created_by) VALUES('PPS-2','ORG-57','CLI-57','E2PAY','UAT','PPA-57','OTP_REQUIRED','seed')`),/UNIQUE constraint failed/);
});

test('P5.7.1 API persists provider challenge server-side and exposes only OTP-safe public state',()=>{
  assert.match(api,/provider_provisioning_sessions/);
  assert.match(api,/state='ACTIVATING'/);
  assert.match(api,/state='READY'/);
  assert.match(api,/E2PAY_PROVISIONING_OTP_REQUESTED/);
  assert.match(api,/E2PAY_PROVISIONING_READY/);
  assert.match(api,/ACTIVATE_SUBACCOUNT/);
  assert.match(api,/credentialMode:'SERVICE_MANAGED'/);
  assert.doesNotMatch(api,/registration:\{[\s\S]{0,200}username:registrationUsername/);
  assert.doesNotMatch(api,/registration:\{[\s\S]{0,200}tokenPrefix/);
});

test('P5.7.1 activation keeps generated secret encrypted during resumable provider confirmation',()=>{
  assert.match(credentials,/encryptProviderProvisioningSecret/);
  assert.match(credentials,/decryptProviderProvisioningSecret/);
  assert.match(api,/pendingProvisioningSecret/);
  assert.match(api,/pendingProvisioningSecret:null/);
});

test('GT5 Master flow retires client OTP and submerchant activation',()=>{
  assert.match(api,/E2PAY_SUBACCOUNT_RETIRED/);
  assert.doesNotMatch(ui,/Verifikasi OTP & Aktifkan|Register E2Pay Sub-Client/);
});
