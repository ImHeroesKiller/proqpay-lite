import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { credentialHealthState, manualCredentialBindingAllowed, markCredentialFailure, markCredentialHealthy } from '../functions/api/e2pay-credential-lifecycle.js';

const api=await readFile(new URL('../functions/api/e2pay-subaccounts.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0058_p57_credential_lifecycle.sql',import.meta.url),'utf8');

test('P5.7.2 service-managed sessions can never be manually rebound',()=>{
  assert.equal(manualCredentialBindingAllowed(null),true);
  assert.equal(manualCredentialBindingAllowed({credential_mode:'SERVICE_MANAGED'}),false);
  assert.match(api,/E2PAY_SERVICE_MANAGED_CREDENTIAL_NO_MANUAL_BIND/);
});

test('P5.7.2 health model escalates three consecutive failures and self-recovers after validation',async()=>{
  const db=new D1Mock();
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-572','MSG','MSG572');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-572','ORG-572','C572','Client 572','ACTIVE');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,account_name,status,created_by)
      VALUES('PPA-572','ORG-572','CLI-572','E2PAY','UAT','SUB_ACCOUNT','Client 572','ACTIVE','seed');
    INSERT INTO provider_provisioning_sessions(id,org_id,client_id,provider,environment,provider_account_registry_id,state,credential_mode,credential_state,credential_version,created_by)
      VALUES('PPS-572','ORG-572','CLI-572','E2PAY','UAT','PPA-572','READY','SERVICE_MANAGED','HEALTHY',1,'seed');
  `);
  let session=db.sqlite.prepare("SELECT * FROM provider_provisioning_sessions WHERE id='PPS-572'").get();
  await markCredentialFailure(db,session,'processor@test','AUTH-1');
  session=db.sqlite.prepare("SELECT * FROM provider_provisioning_sessions WHERE id='PPS-572'").get();
  assert.equal(credentialHealthState(session).state,'DEGRADED');
  await markCredentialFailure(db,session,'processor@test','AUTH-2');
  session=db.sqlite.prepare("SELECT * FROM provider_provisioning_sessions WHERE id='PPS-572'").get();
  assert.equal(credentialHealthState(session).failureCount,2);
  await markCredentialFailure(db,session,'processor@test','AUTH-3');
  session=db.sqlite.prepare("SELECT * FROM provider_provisioning_sessions WHERE id='PPS-572'").get();
  assert.equal(credentialHealthState(session).state,'RECOVERY_REQUIRED');
  assert.equal(credentialHealthState(session).failureCount,3);
  await markCredentialHealthy(db,session,'processor@test');
  session=db.sqlite.prepare("SELECT * FROM provider_provisioning_sessions WHERE id='PPS-572'").get();
  assert.equal(credentialHealthState(session).state,'HEALTHY');
  assert.equal(credentialHealthState(session).failureCount,0);
  assert.equal(credentialHealthState(session).lastErrorCode,null);
  assert.ok(credentialHealthState(session).lastValidatedAt);
});

test('P5.7.2 migration adds durable credential health without persisting secrets',()=>{
  const db=new D1Mock();
  const columns=db.sqlite.prepare('PRAGMA table_info(provider_provisioning_sessions)').all().map((row)=>row.name);
  for(const name of ['credential_state','credential_version','credential_last_validated_at','credential_failure_count','credential_last_error_code','credential_last_error_at']) assert.ok(columns.includes(name),name);
  assert.doesNotMatch(migration,/password|access_token|refresh_token/i);
});

test('P5.7.2 API health check validates scoped identity, audits success and never rewrites service-managed credential',()=>{
  assert.match(api,/CHECK_CREDENTIAL_HEALTH/);
  assert.match(api,/E2PAY_CREDENTIAL_HEALTH_VERIFIED/);
  assert.match(api,/E2PAY_CREDENTIAL_HEALTH_ACCOUNT_MISMATCH/);
  assert.match(api,/markCredentialFailure/);
  assert.match(api,/markCredentialHealthy/);
  const start=api.indexOf("if(action==='CHECK_CREDENTIAL_HEALTH')");
  const end=api.indexOf("if(action==='BIND_SUBACCOUNT_CREDENTIAL')",start);
  const block=api.slice(start,end);
  assert.doesNotMatch(block,/encryptProviderAccountCredential/);
  assert.doesNotMatch(block,/UPDATE payment_provider_accounts SET metadata_json/);
});

test('P5.7.2 UI removes username/password from normal service-managed recovery path',()=>{
  assert.match(ui,/Credential dikelola otomatis/);
  assert.match(ui,/Periksa Ulang Credential/);
  assert.match(ui,/Username\/password tidak perlu dan tidak boleh dimasukkan manual|Username, password merchant/);
  assert.match(ui,/Legacy credential recovery/);
  assert.match(ui,/Migrasikan Credential Legacy/);
});
