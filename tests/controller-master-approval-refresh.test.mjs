import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFixture,roleSession,mockProvider} from './helpers/e2pay-master-fixture.mjs';
import {onRequest as requestApi} from '../functions/api/disbursement-requests.js';
import {onRequest as operationsApi} from '../functions/api/e2pay-operations.js';

const post=(f,headers,body)=>requestApi({request:new Request('https://proqpay.test/api/disbursement-requests',{method:'POST',headers,body:JSON.stringify(body)}),env:f.env});

test('Controller refreshes stale Master balance, approves DR and replays safely without a financial post',async t=>{
 const f=masterFixture();const provider=mockProvider(t);
 // No real execution exists in this scenario: approval must never create one.
 f.database.sqlite.exec("DELETE FROM disbursement_execution_items; DELETE FROM disbursement_executions; UPDATE disbursement_requests SET status='READY' WHERE id='DR-FIX';");
 f.database.sqlite.exec(`INSERT INTO payment_gateway_provider_snapshots(org_id,provider,environment,account_id,merchant_status,balance,refreshed_at) VALUES('ORG-FIX','E2PAY','UAT','PROVIDER-MASTER','ACTIVE',1000000,'2026-01-01T00:00:00Z');
 INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email) VALUES('LIMIT-REFRESH','ORG-FIX','MASTER-FIX','C-FIX','UAT',1000000,1000000,'ACTIVE','processor@test');`);
 const processor=await roleSession(f,'PAYROLL_PROCESSOR');const controller=await roleSession(f,'PAYROLL_CONTROLLER');
 let r=await post(f,processor,{action:'SUBMIT_REQUEST',id:'DR-FIX'});assert.equal(r.status,200,await r.clone().text());
 r=await post(f,controller,{action:'APPROVE_REQUEST',id:'DR-FIX'});assert.equal(r.status,409);assert.equal((await r.json()).code,'E2PAY_FUNDING_PARENT_STALE');
 r=await operationsApi({request:new Request('https://proqpay.test/api/e2pay-operations?resource=account&refresh=1',{headers:controller}),env:f.env});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).account.balance,1e9);
 r=await post(f,controller,{action:'APPROVE_REQUEST',id:'DR-FIX'});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).request.status,'APPROVED');
 r=await post(f,controller,{action:'APPROVE_REQUEST',id:'DR-FIX'});assert.equal(r.status,200);assert.equal((await r.json()).idempotentReplay,true);
 assert.equal(provider.posts().length,0);assert.equal(f.database.sqlite.prepare('SELECT COUNT(*) n FROM disbursement_executions').get().n,0);
 assert.equal(f.database.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='DISBURSEMENT_REQUEST_APPROVED'").get().n,1);
});
