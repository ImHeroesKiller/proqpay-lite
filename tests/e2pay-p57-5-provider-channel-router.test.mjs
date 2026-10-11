import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { canonicalProviderChannelConfig, providerChannelConfigHash, resolveProviderChannel } from '../functions/api/provider-channel-router.js';

const routerApi=await readFile(new URL('../functions/api/provider-channel-mappings.js',import.meta.url),'utf8');
const drApi=await readFile(new URL('../functions/api/disbursement-requests.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0061_p57_provider_channel_router.sql',import.meta.url),'utf8');

test('P5.7.5 channel config is descriptive only and strips execution/security overrides',()=>{
  const config=canonicalProviderChannelConfig({
    providerChannel:' payroll_employee ',contractVersion:'v1',metadata:{
      providerRouteCode:'R1',providerPurposeCode:'PAY',transactionType:'DISBURSEMENT',descriptionPrefix:'PAYROLL',notes:'confirmed',
      endpoint:'https://evil.invalid',accountSrc:'OTHER',username:'secret',password:'secret',accessToken:'secret',rawPayload:'{}',
    },
  });
  assert.equal(config.providerChannel,'PAYROLL_EMPLOYEE');
  assert.deepEqual(Object.keys(config.metadata).sort(),['descriptionPrefix','notes','providerPurposeCode','providerRouteCode','transactionType'].sort());
  assert.equal('endpoint' in config.metadata,false);
  assert.equal('accountSrc' in config.metadata,false);
  assert.equal('password' in config.metadata,false);
});

test('P5.7.5 resolver is fail-closed until mapping is active, confirmed and hash-valid',async()=>{
  const db=new D1Mock();
  db.sqlite.exec(`INSERT INTO provider_channel_mappings(id,provider,environment,purpose,destination_mode,beneficiary_type,mapping_status,config_json,created_by)
    VALUES('PCM-575','E2PAY','UAT','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE','PENDING_PROVIDER_CONFIRMATION','{}','seed')`);
  let result=await resolveProviderChannel(db,{provider:'E2PAY',environment:'UAT',purpose:'PAYROLL',destinationMode:'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE',now:'2026-10-11T00:00:00.000Z'});
  assert.equal(result.ok,false);
  assert.equal(result.code,'PROVIDER_CHANNEL_MAPPING_REQUIRED');

  const config={providerChannel:'PAYROLL_EMPLOYEE',contractVersion:'1',metadata:{providerRouteCode:'R1'}};
  const hash=await providerChannelConfigHash(config);
  db.sqlite.prepare(`UPDATE provider_channel_mappings SET provider_channel=?,mapping_status='ACTIVE',config_json=?,contract_version='1',config_hash=?,confirmed_by='admin@test',confirmed_at='2026-10-10T00:00:00.000Z',confirmation_reference='E2Pay meeting/ref-1' WHERE id='PCM-575'`)
    .run(config.providerChannel,JSON.stringify(config.metadata),hash);
  result=await resolveProviderChannel(db,{provider:'E2PAY',environment:'UAT',purpose:'PAYROLL',destinationMode:'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE',now:'2026-10-11T00:00:00.000Z'});
  assert.equal(result.ok,true);
  assert.equal(result.snapshot.providerChannel,'PAYROLL_EMPLOYEE');
  assert.equal(result.snapshot.intentKey,'PAYROLL:DIRECT_EMPLOYEE:EMPLOYEE');
  assert.equal(result.snapshot.configHash,hash);

  db.sqlite.prepare(`UPDATE provider_channel_mappings SET config_json='{"providerRouteCode":"CHANGED"}' WHERE id='PCM-575'`).run();
  result=await resolveProviderChannel(db,{provider:'E2PAY',environment:'UAT',purpose:'PAYROLL',destinationMode:'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE',now:'2026-10-11T00:00:00.000Z'});
  assert.equal(result.ok,false);
  assert.equal(result.code,'PROVIDER_CHANNEL_CONFIG_INTEGRITY_FAILED');
});

test('P5.7.5 schema requires confirmation evidence before ACTIVE mapping',async()=>{
  const db=new D1Mock();
  assert.throws(()=>db.sqlite.exec(`INSERT INTO provider_channel_mappings(id,provider,environment,purpose,destination_mode,beneficiary_type,provider_channel,mapping_status,config_json,contract_version,created_by)
    VALUES('PCM-BAD','E2PAY','UAT','EWA','DIRECT_EMPLOYEE','EMPLOYEE','EWA_EMPLOYEE','ACTIVE','{}','1','seed')`),/confirmation evidence/);
  assert.match(migration,/confirmation_reference/);
  assert.match(migration,/disbursement_provider_channel_immutable_pending/);
});

test('P5.7.5 DR submission resolves and snapshots provider channel before approval',()=>{
  assert.match(drApi,/resolveProviderChannel/);
  assert.match(drApi,/PROVIDER_CHANNEL_MAPPING_REQUIRED|route\.code/);
  assert.match(drApi,/provider_channel_mapping_id=\?,provider_channel_snapshot=\?/);
  assert.match(drApi,/DISBURSEMENT_PROVIDER_CHANNEL_BOUND/);
  assert.match(drApi,/PENDING_APPROVAL/);
});

test('P5.7.5 mapping management is integrations-admin only and never accepts arbitrary endpoint or secrets',()=>{
  assert.match(routerApi,/integrations:manage/);
  assert.match(routerApi,/SAVE_DRAFT/);
  assert.match(routerApi,/ACTIVATE_MAPPING/);
  assert.match(routerApi,/DEACTIVATE_MAPPING/);
  assert.match(routerApi,/confirmationReference/);
  assert.doesNotMatch(routerApi,/body\?\.endpoint|body\.endpoint/);
  assert.doesNotMatch(routerApi,/body\?\.password|body\.password/);
  assert.doesNotMatch(routerApi,/body\?\.accountSrc|body\.accountSrc/);
});

test('P5.7.5 submitted channel snapshot cannot be rebound after PENDING_APPROVAL',()=>{
  const db=new D1Mock();
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-575','MSG','M575');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-575','ORG-575','C575','Client','ACTIVE');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,account_name,status,created_by)
      VALUES('PPA-575','ORG-575','CLI-575','E2PAY','UAT','SUB_ACCOUNT','SUB-575','Client','ACTIVE','seed');
    INSERT INTO provider_channel_mappings(id,provider,environment,purpose,destination_mode,beneficiary_type,provider_channel,mapping_status,config_json,contract_version,config_hash,confirmed_by,confirmed_at,confirmation_reference,created_by)
      VALUES('PCM-575A','E2PAY','UAT','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE','PAYROLL_EMPLOYEE','ACTIVE','{}','1','HASH','admin','2026-10-10T00:00:00Z','REF','seed');
    INSERT INTO disbursement_requests(id,org_id,client_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,provider_channel_mapping_id,provider_channel_snapshot,amount,recipient_count,client_reference,correlation_id,idempotency_key,routing_hash,status,requested_by_email,requested_at,created_by_email)
      VALUES('DR-575','ORG-575','CLI-575','E2PAY','PPA-575','SUB-575','UAT','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE','PAYMENT_INSTRUCTION','PI-575','PCM-575A','{"providerChannel":"PAYROLL_EMPLOYEE"}',1000,1,'REF-DR','CORR','IDEM','ROUTE','PENDING_APPROVAL','processor@test','2026-10-11T00:00:00Z','processor@test');
  `);
  assert.throws(()=>db.sqlite.exec(`UPDATE disbursement_requests SET provider_channel_snapshot='{"providerChannel":"OTHER"}' WHERE id='DR-575'`),/Submitted disbursement provider channel is immutable/);
});
