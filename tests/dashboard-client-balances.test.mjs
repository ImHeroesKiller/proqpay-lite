import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFixture} from './helpers/e2pay-master-fixture.mjs';
import {dashboardClientBalances} from '../functions/api/dashboard-client-balances.js';
import {handleD1OperatingModel} from '../functions/api/operating-model-d1.js';
function funded(){
 const f=masterFixture();f.database.sqlite.exec(`
 INSERT INTO payment_gateway_provider_snapshots(org_id,provider,environment,account_id,merchant_status,balance) VALUES('ORG-FIX','E2PAY','UAT','PROVIDER-MASTER','ACTIVE',8000);
 INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email) VALUES('LIMIT-FIX','ORG-FIX','MASTER-FIX','C-FIX','UAT',10000,10000,'ACTIVE','maker@test');
 INSERT INTO e2pay_disbursement_limit_usage(id,org_id,limit_request_id,provider_account_registry_id,payment_instruction_id,reserved_amount,status) VALUES('USAGE-FIX','ORG-FIX','LIMIT-FIX','MASTER-FIX','PI-FIX',3000,'RESERVED');`);return f;
}
const rows=f=>dashboardClientBalances(f.database,'ORG-FIX',f.env);
test('client availability uses remaining approved allocation capped by shared Master liquidity',async()=>{
 const f=funded();const [r]=await rows(f);assert.equal(r.availableAmount,7000);assert.equal(r.remainingLimit,7000);assert.equal(r.blocked,false);
 f.database.sqlite.exec('UPDATE payment_gateway_provider_snapshots SET balance=5000');assert.equal((await rows(f))[0].availableAmount,5000);
});
test('overdue AR blocks availability without erasing the approved allocation; paid AR clears the block',async()=>{
 const f=funded();f.database.sqlite.exec(`INSERT INTO ar_monitor(id,org_id,client_id,amount,balance,status,due_date) VALUES('AR-FIX','ORG-FIX','C-FIX',100,100,'OUTSTANDING','2000-01-01')`);
 let r=(await rows(f))[0];assert.equal(r.blocked,true);assert.equal(r.availableAmount,0);assert.equal(r.remainingLimit,7000);assert.equal(r.reasons[0].code,'AR_OUTSTANDING_PAYMENT_BLOCKED');
 f.database.sqlite.exec("UPDATE ar_monitor SET balance=0,status='PAID'");r=(await rows(f))[0];assert.equal(r.blocked,false);assert.equal(r.availableAmount,7000);
});
test('stale balance is unknown, never a claimed available balance',async()=>{
 const f=funded();f.database.sqlite.exec("UPDATE payment_gateway_provider_snapshots SET refreshed_at='2000-01-01'");const [r]=await rows(f);assert.equal(r.availableAmount,null);assert.ok(r.reasons.some(x=>x.code==='BALANCE_NOT_READY'));
});
test('inactive clients, exhausted and missing limits show distinct block reasons',async()=>{
 const f=funded();f.database.sqlite.exec("UPDATE clients SET status='INACTIVE' WHERE id='C-FIX'");assert.ok((await rows(f))[0].reasons.some(x=>x.code==='CLIENT_INACTIVE'));
 f.database.sqlite.exec("UPDATE clients SET status='ACTIVE';UPDATE e2pay_disbursement_limit_usage SET reserved_amount=10000");assert.ok((await rows(f))[0].reasons.some(x=>x.code==='LIMIT_EXHAUSTED'));
 f.database.sqlite.exec("UPDATE e2pay_disbursement_limit_requests SET status='REVOKED'");assert.ok((await rows(f))[0].reasons.some(x=>x.code==='NO_AVAILABLE_LIMIT'));
});
test('clients without a pay run are included; client/tenant scope cannot pull another client balance',async()=>{
 const f=funded();f.database.sqlite.exec("INSERT INTO clients(id,org_id,code,name,status) VALUES('C-OTHER','ORG-FIX','OTHER','Other client','ACTIVE')");assert.equal((await rows(f)).length,2);
 assert.deepEqual(await dashboardClientBalances(f.database,'ORG-FIX',f.env,'UNKNOWN'),[]);
 assert.deepEqual(await dashboardClientBalances(f.database,'OTHER-ORG',f.env),[]);
 const response=await handleD1OperatingModel({request:new Request('https://proqpay.test/api/operating-model?resource=dashboard&period=2026-10'),env:f.env},{role:'CLIENT_USER',id:'client',permissions:['read'],clientIds:['C-FIX']});assert.equal(response.status,200);assert.deepEqual((await response.json()).clientBalances,[]);
});
