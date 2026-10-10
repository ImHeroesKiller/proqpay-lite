import assert from 'node:assert/strict';
import test from 'node:test';
import { D1Mock } from './helpers/d1-mock.mjs';
import { disbursementLimitSchemaReady, readProviderFundingState, reserveDisbursementLimit } from '../functions/api/e2pay-disbursement-limit-core.js';

function seedBase(db){
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-X','Org X','ORGX');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-A','ORG-X','A','Client A','ACTIVE');
    INSERT INTO payment_provider_accounts
      (id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,balance,available_balance,last_balance_sync_at,created_by)
      VALUES('PPA-A','ORG-X','CLI-A','E2PAY','UAT','SUB_ACCOUNT','SUB-0190','ACTIVE',50000000,50000000,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'seed');
    INSERT INTO payment_gateway_provider_snapshots
      (org_id,provider,environment,account_id,account_name,balance,source,refreshed_at)
      VALUES('ORG-X','E2PAY','UAT','MASTER-1','ProQPay',100000000,'PROVIDER',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  `);
}

test('P5.6 schema guard returns migration-required funding state instead of throwing',async()=>{
  const db=new D1Mock();
  seedBase(db);
  db.sqlite.exec('DROP TABLE e2pay_disbursement_limit_usage; DROP TABLE e2pay_disbursement_limit_requests;');
  assert.equal(await disbursementLimitSchemaReady(db),false);
  const state=await readProviderFundingState(db,'ORG-X','PPA-A',15900000,'PI-A');
  assert.equal(state.ready,false);
  assert.equal(state.state,'LIMIT_SCHEMA_REQUIRED');
  assert.equal(state.limit.state,'SCHEMA_REQUIRED');
  assert.equal(state.subClient.ready,true);
});

test('P5.6 reservation fails closed when migration is missing',async()=>{
  const db=new D1Mock();
  db.sqlite.exec('DROP TABLE e2pay_disbursement_limit_usage; DROP TABLE e2pay_disbursement_limit_requests;');
  const result=await reserveDisbursementLimit(db,{
    organizationId:'ORG-X',providerAccountRegistryId:'PPA-A',paymentInstructionId:'PI-A',amount:15900000,
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,'E2PAY_LIMIT_SCHEMA_REQUIRED');
});
