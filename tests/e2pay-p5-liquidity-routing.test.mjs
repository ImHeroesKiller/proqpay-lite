import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { D1Mock } from './helpers/d1-mock.mjs';
import { liquidityState, providerSnapshot, validatePaymentProviderSnapshot } from '../functions/api/payment-provider-routing.js';
import { e2payExecutionContract } from '../functions/api/payment-gateway-e2pay.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

function activeAccount(overrides={}){
  return {
    id:'PPA-A',org_id:'ORG-X',client_id:'CLI-A',provider:'E2PAY',environment:'UAT',
    account_scope:'SUB_ACCOUNT',provider_sub_account_id:'SUB-CLIENT-A',status:'ACTIVE',
    balance:120_000_000,available_balance:120_000_000,last_balance_sync_at:new Date().toISOString(),
    account_name:'Client A',currency:'IDR',...overrides,
  };
}

test('P5.2 liquidity is fail-closed for missing, stale and insufficient balances',()=>{
  assert.equal(liquidityState(null,10).state,'NOT_MAPPED');
  assert.equal(liquidityState(activeAccount({available_balance:null,last_balance_sync_at:null}),10).state,'NOT_SYNCED');
  assert.equal(liquidityState(activeAccount({last_balance_sync_at:new Date(Date.now()-10*60*1000).toISOString()}),10).state,'STALE');
  const insufficient=liquidityState(activeAccount({available_balance:90}),100);
  assert.equal(insufficient.state,'INSUFFICIENT');
  assert.equal(insufficient.gap,10);
  assert.equal(liquidityState(activeAccount({available_balance:100}),100).state,'FUNDED');
});

test('P5.3 PI provider snapshot validates client and immutable sub-account ownership',()=>{
  const account=activeAccount();
  const payment={
    client_id:'CLI-A',provider_account_registry_id:'PPA-A',provider:'E2PAY',
    provider_environment:'UAT',provider_sub_account_id:'SUB-CLIENT-A',
  };
  assert.equal(validatePaymentProviderSnapshot(payment,account).ok,true);
  assert.equal(validatePaymentProviderSnapshot({...payment,client_id:'CLI-B'},account).code,'PI_PROVIDER_CLIENT_MISMATCH');
  assert.equal(validatePaymentProviderSnapshot({...payment,provider_sub_account_id:'SUB-OTHER'},account).code,'PI_PROVIDER_SUBACCOUNT_MISMATCH');
  const snapshot=providerSnapshot(account);
  assert.equal(snapshot.subAccountLast4,'NT-A');
  assert.equal(snapshot.clientId,'CLI-A');
});

test('P5.3 migration makes provider routing snapshot immutable after PI creation',()=>{
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-X','Org X','ORGX');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-A','ORG-X','A','Client A','ACTIVE');
    INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('SP-A','CLI-A','STANDARD','ACTIVE','2026-01-01','seed');
    INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by)
      VALUES('SUB-A','ORG-X','CLI-A','SP-A','STANDARD','2026-10','CLIENT_APPROVED','seed');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,created_by)
      VALUES('PPA-A','ORG-X','CLI-A','E2PAY','UAT','SUB_ACCOUNT','SUB-CLIENT-A','ACTIVE','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count,
       provider_account_registry_id,provider,provider_environment,provider_sub_account_id,provider_account_snapshot)
      VALUES('PI-A','ORG-X','CLI-A','SUB-A','PAYMENT_INSTRUCTION_READY',100,'USR','IDEMP-A',1,
       'PPA-A','E2PAY','UAT','SUB-CLIENT-A','{"registryId":"PPA-A"}');
  `);
  assert.throws(()=>DB.sqlite.exec("UPDATE payment_instructions SET provider_sub_account_id='SUB-OTHER' WHERE id='PI-A'"),/immutable/);
  assert.doesNotThrow(()=>DB.sqlite.exec("UPDATE payment_instructions SET status='PAYMENT_APPROVAL_PENDING' WHERE id='PI-A'"));
});

test('P5.3 sub-account source mode permits parent-token routing without restoring global accountSrc authority',()=>{
  const env={
    E2PAY_ENV:'UAT',E2PAY_ACCOUNT_SRC:'SUB-CLIENT-A',E2PAY_SOURCE_ID:'SRC',
    E2PAY_PASSWORD_MD5:'A'.repeat(32),E2PAY_SOURCE_MODE:'SUB_ACCOUNT_SNAPSHOT',
  };
  const contract=e2payExecutionContract(env,{accountId:'MASTER-MSG'});
  assert.equal(contract.valid,true);
  assert.equal(contract.sourceMode,'SUB_ACCOUNT_SNAPSHOT');
  assert.equal(contract.accountSrcMatchesMerchant,false);
});

test('P5.2/P5.3 wiring gates approval and execution on client liquidity and routed source account',async()=>{
  const [operating,gateway,service,subaccounts]=await Promise.all([
    read('functions/api/operating-model-d1.js'),
    read('functions/api/payment-gateway.js'),
    read('functions/api/payment-gateway-e2pay-service.js'),
    read('functions/api/e2pay-subaccounts.js'),
  ]);
  assert.match(operating,/E2PAY_SUBACCOUNT_MAPPING_REQUIRED/);
  assert.match(operating,/E2PAY_LIQUIDITY_/);
  assert.match(operating,/provider_account_registry_id,provider,provider_environment,provider_sub_account_id/);
  assert.match(gateway,/validatePaymentProviderSnapshot/);
  assert.match(gateway,/E2PAY_SOURCE_MODE:'SUB_ACCOUNT_SNAPSHOT'/);
  assert.match(gateway,/liquidityBalance:providerAccount\?\.available_balance/);
  assert.match(service,/liquidityBalance===null/);
  assert.match(subaccounts,/E2PAY_SUBACCOUNT_BALANCE_SOURCE_MISMATCH/);
  assert.doesNotMatch(subaccounts,/SET_BALANCE|MANUAL_BALANCE|body\.balance/);
});
