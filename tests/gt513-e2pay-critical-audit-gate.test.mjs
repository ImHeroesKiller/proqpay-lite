import test from 'node:test';
import assert from 'node:assert/strict';
import {e2payDisburse,E2PayRequestError} from '../functions/api/payment-gateway-e2pay.js';

const env={
 E2PAY_ENV:'UAT',
 E2PAY_ACCOUNT_SRC:'MASTER-TEST',
 E2PAY_PASSWORD_MD5:'A'.repeat(32),
 E2PAY_SOURCE_ID:'MASTER-SOURCE',
};
const input={clientRef:'PI-TEST-STABLE',description:'Test',inquiryId:'INQ-TEST'};
test('E2Pay disbursement fails closed before HTTP if audit sink is absent',async()=>{
 let providerCalls=0;
 await assert.rejects(
  ()=>e2payDisburse(env,'dummy',input,async()=>{providerCalls++;return new Response('{}')}),
  e=>e instanceof E2PayRequestError&&e.code==='E2PAY_AUDIT_REQUIRED');
 assert.equal(providerCalls,0);
});
test('E2Pay disbursement fails closed if audit preparation fails',async()=>{
 let providerCalls=0;
 await assert.rejects(
  ()=>e2payDisburse({...env,__e2payAudit:async()=>{throw new Error('D1 unavailable');}},'dummy',input,async()=>{providerCalls++;return new Response('{}')}),
  e=>e.code==='E2PAY_AUDIT_PREPARE_FAILED');
 assert.equal(providerCalls,0);
});
test('E2Pay uses one prepared row and completes audit on the same request ID',async()=>{
 const rows=[];
 let providerCalls=0;
 const response=await e2payDisburse({...env,__e2payAudit:async value=>rows.push({...value})},'dummy',input,async()=>{
   providerCalls++;
   return new Response(JSON.stringify({status:'OK'}),{status:200});
 });
 assert.equal(providerCalls,1);
 assert.equal(response.status,'OK');
 assert.equal(rows.length,2);
 assert.equal(rows[0].phase,'PREPARED');
 assert.equal(rows[1].phase,'COMPLETE');
 assert.equal(rows[0].requestId,rows[1].requestId);
 assert.equal(rows[1].requestJson.password,'[REDACTED]');
 assert.equal(rows[1].requestJson.clientRef,'PI-TEST-STABLE');
});
