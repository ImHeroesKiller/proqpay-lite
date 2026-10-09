import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { D1Mock } from './helpers/d1-mock.mjs';
import { roleCanAction } from '../shared/authority-matrix.js';
import {
  consumeDisbursementLimit,
  readProviderFundingState,
  reserveDisbursementLimit,
} from '../functions/api/e2pay-disbursement-limit-core.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

function seed(db){
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-X','Org X','ORGX');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-A','ORG-X','A','Client A','ACTIVE');
    INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by)
      VALUES('SP-A','CLI-A','STANDARD','ACTIVE','2026-01-01','seed');
    INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by)
      VALUES('SUB-A','ORG-X','CLI-A','SP-A','STANDARD','2026-09','APPROVED_FOR_PAYMENT','seed');
    INSERT INTO payment_provider_accounts
      (id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,balance,available_balance,last_balance_sync_at,created_by)
      VALUES('PPA-A','ORG-X','CLI-A','E2PAY','UAT','SUB_ACCOUNT','SUB-0190','ACTIVE',50000000,50000000,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'seed');
    INSERT INTO payment_gateway_provider_snapshots
      (org_id,provider,environment,account_id,account_name,balance,source,refreshed_at)
      VALUES('ORG-X','E2PAY','UAT','MASTER-1','ProQPay',100000000,'PROVIDER',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count,
       provider_account_registry_id,provider,provider_environment,provider_sub_account_id,provider_account_snapshot)
      VALUES
      ('PI-A','ORG-X','CLI-A','SUB-A','APPROVED_FOR_PAYMENT',15900000,'USR-P','IDEMP-A',3,'PPA-A','E2PAY','UAT','SUB-0190','{"registryId":"PPA-A"}'),
      ('PI-B','ORG-X','CLI-A','SUB-A','APPROVED_FOR_PAYMENT',10000000,'USR-P','IDEMP-B',1,'PPA-A','E2PAY','UAT','SUB-0190','{"registryId":"PPA-A"}');
    INSERT INTO e2pay_disbursement_limit_requests
      (id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,reason,requested_by_email,approved_by_email,approved_at)
      VALUES('DLR-A','ORG-X','PPA-A','CLI-A','UAT',20000000,20000000,'ACTIVE','Payroll limit','processor@test','controller@test',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  `);
}

test('P5.6 authority separates Processor request from Controller approval',()=>{
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','disbursement-limit.request'),true);
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','disbursement-limit.approve'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','disbursement-limit.request'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','disbursement-limit.approve'),true);
  assert.equal(roleCanAction('SUPER_ADMIN','disbursement-limit.approve'),false);
});

test('P5.6 funding state exposes parent, sub-client, approved limit and effective capacity',async()=>{
  const db=new D1Mock();
  seed(db);
  const state=await readProviderFundingState(db,'ORG-X','PPA-A',15900000,'PI-A');
  assert.equal(state.parent.ready,true);
  assert.equal(state.parent.balance,100000000);
  assert.equal(state.subClient.ready,true);
  assert.equal(state.subClient.availableBalance,50000000);
  assert.equal(state.limit.state,'AVAILABLE');
  assert.equal(state.limit.approvedAmount,20000000);
  assert.equal(state.limit.remainingAmount,20000000);
  assert.equal(state.effectiveDisbursementCapacity,20000000);
  assert.equal(state.ready,true);
});

test('P5.6 limit reservation is atomic, idempotent per PI and prevents double allocation',async()=>{
  const db=new D1Mock();
  seed(db);
  const first=await reserveDisbursementLimit(db,{
    organizationId:'ORG-X',providerAccountRegistryId:'PPA-A',paymentInstructionId:'PI-A',amount:15900000,
  });
  assert.equal(first.ok,true);

  const replay=await reserveDisbursementLimit(db,{
    organizationId:'ORG-X',providerAccountRegistryId:'PPA-A',paymentInstructionId:'PI-A',amount:15900000,
  });
  assert.equal(replay.ok,true);
  assert.equal(replay.idempotent,true);

  const second=await reserveDisbursementLimit(db,{
    organizationId:'ORG-X',providerAccountRegistryId:'PPA-A',paymentInstructionId:'PI-B',amount:10000000,
  });
  assert.equal(second.ok,false);
  assert.equal(second.code,'E2PAY_DISBURSEMENT_LIMIT_INSUFFICIENT');

  const state=await readProviderFundingState(db,'ORG-X','PPA-A',15900000,'PI-A');
  assert.equal(state.limit.committedAmount,15900000);
  assert.equal(state.limit.remainingAmount,4100000);
  assert.equal(state.limit.capacityForPayment,20000000);
});

test('P5.6 successful payment consumes reservation and exhausts fully used limit only',async()=>{
  const db=new D1Mock();
  seed(db);
  await reserveDisbursementLimit(db,{
    organizationId:'ORG-X',providerAccountRegistryId:'PPA-A',paymentInstructionId:'PI-A',amount:15900000,
  });
  await consumeDisbursementLimit(db,'PI-A',15900000);
  const usage=db.sqlite.prepare("SELECT status,consumed_amount FROM e2pay_disbursement_limit_usage WHERE payment_instruction_id='PI-A'").get();
  assert.equal(usage.status,'CONSUMED');
  assert.equal(usage.consumed_amount,15900000);
  const limit=db.sqlite.prepare("SELECT status FROM e2pay_disbursement_limit_requests WHERE id='DLR-A'").get();
  assert.equal(limit.status,'ACTIVE');
});

test('P5.6 routing remains immutable while approval-time balance evidence can refresh',()=>{
  const db=new D1Mock();
  seed(db);
  assert.doesNotThrow(()=>db.sqlite.exec("UPDATE payment_instructions SET provider_available_balance_snapshot=50000000,provider_balance_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='PI-A'"));
  assert.throws(()=>db.sqlite.exec("UPDATE payment_instructions SET provider_sub_account_id='SUB-OTHER' WHERE id='PI-A'"),/immutable/);
});

test('P5.6 API and gateway wire maker-checker, funding gate, reservation and consumption',async()=>{
  const [api,gateway,operating,ui]=await Promise.all([
    read('functions/api/e2pay-disbursement-limits.js'),
    read('functions/api/payment-gateway.js'),
    read('functions/api/operating-model-d1.js'),
    read('src/components/E2PayFundingLimitControl.tsx'),
  ]);
  assert.match(api,/actor\.role!=='PAYROLL_PROCESSOR'/);
  assert.match(api,/actor\.role!=='PAYROLL_CONTROLLER'/);
  assert.match(api,/E2PAY_DISBURSEMENT_LIMIT_REQUESTED/);
  assert.match(api,/E2PAY_DISBURSEMENT_LIMIT_APPROVED/);
  assert.match(gateway,/reserveDisbursementLimit/);
  assert.match(gateway,/consumeDisbursementLimit/);
  assert.match(gateway,/E2PAY_FUNDING_/);
  assert.match(operating,/Approved disbursement limit sub-client belum tersedia/);
  assert.match(ui,/ProQPay → Sub-client → Disbursement Limit/);
  assert.match(ui,/Ajukan Limit ke Controller/);
  assert.match(ui,/Approve Limit/);
});
