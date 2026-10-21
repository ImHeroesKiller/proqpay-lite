import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFixture,roleSession} from './helpers/e2pay-master-fixture.mjs';
import {E2PAY_AUTOMATIC_INTENTS,automaticE2PayRoute} from '../functions/api/e2pay-automatic-routing.js';
import {resolveProviderChannel,validateProviderChannelSnapshot} from '../functions/api/provider-channel-router.js';
import {onRequest as routingApi} from '../functions/api/provider-channel-mappings.js';
import {onRequest as requestApi} from '../functions/api/disbursement-requests.js';
import {e2payDisburse} from '../functions/api/payment-gateway-e2pay.js';
import {executeCanonicalE2Pay} from '../functions/api/disbursement-execution-e2pay.js';

const input=(f,intent=E2PAY_AUTOMATIC_INTENTS[0])=>({...intent,provider:'E2PAY',orgId:'ORG-FIX',environment:'UAT',registryId:'MASTER-FIX'});
const post=(handler,f,headers,body)=>handler({request:new Request('https://proqpay.test/api/test',{method:'POST',headers,body:JSON.stringify(body)}),env:f.env});
const noNetwork=t=>t.mock.method(globalThis,'fetch',async()=>{assert.fail('Routing must not call provider or run a payment');});

test('All three intents derive distinct immutable SSD routes without manual mapping, credentials exposure or provider requests',async t=>{
 noNetwork(t);const f=masterFixture();const hashes=[];
 for(const intent of E2PAY_AUTOMATIC_INTENTS){
  const r=await resolveProviderChannel(f.database,input(f,intent),f.env);
  assert.equal(r.ok,true);assert.equal(r.mapping,null);assert.equal(r.snapshot.routingMode,'AUTOMATIC');
  assert.equal(r.snapshot.providerChannel,'E2PAY_SDP');assert.equal(r.snapshot.transactionPath,'/b2b/merchant/me/sdp/transaction');
  assert.equal(r.snapshot.sourceDocumentType,intent.sourceDocumentType);hashes.push(r.snapshot.configHash);
  const serialized=JSON.stringify(r.snapshot);assert.ok(!serialized.includes(f.env.E2PAY_PASSWORD_MD5));assert.ok(!serialized.includes(f.env.E2PAY_ACCOUNT_SRC));assert.ok(!serialized.includes(f.env.E2PAY_SOURCE_ID));
 }
 assert.equal(new Set(hashes).size,3);
 assert.equal(f.database.sqlite.prepare('SELECT COUNT(*) n FROM provider_channel_mappings').get().n,0);
});

test('Automatic routing rejects missing credentials, registry/tenant/environment mismatch and unsupported EWA destinations',async t=>{
 noNetwork(t);const f=masterFixture();
 for(const change of [{E2PAY_SOURCE_ID:''},{E2PAY_PASSWORD_MD5:'invalid'},{E2PAY_ACCOUNT_SRC:'OTHER'},{PAYMENT_GATEWAY_PROVIDER:'UNCONFIGURED'},{E2PAY_SOURCE_MODE:'SUB_ACCOUNT_SNAPSHOT'}])assert.equal((await automaticE2PayRoute(f.database,{...f.env,...change},input(f))).ok,false);
 for(const change of [{environment:'PRODUCTION'},{orgId:'OTHER-ORG'},{registryId:'OTHER-MASTER'},{purpose:'EWA',destinationMode:'CLIENT_ACCOUNT',beneficiaryType:'CORPORATE',sourceDocumentType:'EWA_REQUEST'},{sourceDocumentType:'EWA_REQUEST'}])assert.equal((await automaticE2PayRoute(f.database,f.env,{...input(f),...change})).ok,false);
 f.database.sqlite.prepare("UPDATE payment_provider_accounts SET status='INACTIVE' WHERE id='MASTER-FIX'").run();
 assert.equal((await automaticE2PayRoute(f.database,f.env,input(f))).ok,false);
});

test('Approval/execution snapshot validation rejects changed route, identity, source and contract rather than regenerating it',async t=>{
 noNetwork(t);const f=masterFixture();const {snapshot}=await automaticE2PayRoute(f.database,f.env,input(f));
 const row={...f.request,provider_channel_mapping_id:null,provider_channel_snapshot:JSON.stringify(snapshot)};
 assert.equal((await validateProviderChannelSnapshot(f.database,row,f.env)).ok,true);
 for(const change of [{providerChannel:'OTHER'},{transactionPath:'/other'},{metadata:{descriptionPrefix:'OTHER'}},{configHash:'bad'},{environment:'PRODUCTION'},{intentKey:'EWA:DIRECT_EMPLOYEE:EMPLOYEE'},{routingMode:'MANUAL'}])assert.equal((await validateProviderChannelSnapshot(f.database,{...row,provider_channel_snapshot:JSON.stringify({...snapshot,...change})},f.env)).ok,false);
 for(const value of ['null','[]','invalid'])assert.equal((await validateProviderChannelSnapshot(f.database,{...row,provider_channel_snapshot:value},f.env)).ok,false);
 for(const change of [{E2PAY_SOURCE_ID:'NEW-SOURCE'},{E2PAY_ACCOUNT_SRC:'OTHER'},{E2PAY_ENV:'PRODUCTION'}])assert.equal((await validateProviderChannelSnapshot(f.database,row,{...f.env,...change})).ok,false);
 assert.equal((await validateProviderChannelSnapshot(f.database,{...row,provider_channel_mapping_id:'MANUAL-ID'},f.env)).ok,false);
});

test('Routing status uses central environment, is read-only for operational roles, and rejects manual mutation',async t=>{
 noNetwork(t);const f=masterFixture();
 for(const role of ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER']){
  const headers=await roleSession(f,role);
  const r=await routingApi({request:new Request('https://proqpay.test/api/provider-channel-mappings?environment=PRODUCTION',{headers}),env:f.env});
  assert.equal(r.status,role==='CLIENT_USER'?403:200);
  if(r.ok){const body=await r.json();assert.equal(body.environment,'UAT');assert.equal(body.routes.length,3);assert.ok(body.routes.every(r=>r.ready));}
  const mutation=await post(routingApi,f,headers,{action:'ACTIVATE_MAPPING',providerChannel:'FAKE',confirmationReference:'FAKE'});
  assert.equal(mutation.status,role==='SUPER_ADMIN'?410:403);
 }
 assert.equal(f.database.sqlite.prepare('SELECT COUNT(*) n FROM provider_channel_mappings').get().n,0);
});

test('Submit DR binds automatic snapshot once; Controller approval still requires funding and cannot rebind submitted route',async t=>{
 noNetwork(t);const f=masterFixture();
 f.database.sqlite.prepare("UPDATE disbursement_requests SET status='READY' WHERE id='DR-FIX'").run();
 const processor=await roleSession(f,'PAYROLL_PROCESSOR');const controller=await roleSession(f,'PAYROLL_CONTROLLER');
 let r=await post(requestApi,f,processor,{action:'SUBMIT_REQUEST',id:'DR-FIX'});assert.equal(r.status,200,await r.clone().text());
 const row=f.database.sqlite.prepare("SELECT * FROM disbursement_requests WHERE id='DR-FIX'").get();
 assert.equal(row.status,'PENDING_APPROVAL');assert.equal(row.provider_channel_mapping_id,null);assert.equal(JSON.parse(row.provider_channel_snapshot).routingMode,'AUTOMATIC');
 assert.throws(()=>f.database.sqlite.prepare("UPDATE disbursement_requests SET provider_channel_snapshot='{}' WHERE id='DR-FIX'").run(),/immutable/);
 r=await post(requestApi,f,processor,{action:'APPROVE_REQUEST',id:'DR-FIX'});assert.equal(r.status,403);
 r=await post(requestApi,f,controller,{action:'APPROVE_REQUEST',id:'DR-FIX'});assert.equal(r.status,409);assert.match((await r.json()).code,/FUNDING/);
 assert.equal(f.database.sqlite.prepare("SELECT status FROM disbursement_requests WHERE id='DR-FIX'").get().status,'PENDING_APPROVAL');
});

test('Missing Master credentials cannot advance a READY DR',async t=>{
 noNetwork(t);const f=masterFixture();f.env.E2PAY_SOURCE_ID='';
 f.database.sqlite.prepare("UPDATE disbursement_requests SET status='READY' WHERE id='DR-FIX'").run();
 const headers=await roleSession(f,'PAYROLL_PROCESSOR');const r=await post(requestApi,f,headers,{action:'SUBMIT_REQUEST',id:'DR-FIX'});
 assert.equal(r.status,409);assert.equal(f.database.sqlite.prepare("SELECT status FROM disbursement_requests WHERE id='DR-FIX'").get().status,'READY');
});

test('Automatic route labels do not add undocumented channel fields or override Master source in E2Pay payload',async()=>{
 const f=masterFixture();let payload;
 await e2payDisburse(f.env,'mock-token',{clientRef:'TEST',inquiryId:'INQ',description:'PAYROLL',providerChannel:'FAKE',sourceId:'OTHER',accountSrc:'OTHER'},async(url,init)=>{
  assert.ok(url.endsWith('/b2b/merchant/me/sdp/transaction'));payload=JSON.parse(init.body);return new Response(JSON.stringify({responseCode:'00'}),{status:200});
 });
 assert.deepEqual(Object.keys(payload).sort(),['accountSrc','clientRef','description','password','inquiryId','sourceId'].sort());
 assert.equal(payload.accountSrc,f.env.E2PAY_ACCOUNT_SRC);assert.equal(payload.sourceId,f.env.E2PAY_SOURCE_ID);
});

test('Actual execution environment must match approved source; partial sends retain reconciliation and reservations',async t=>{
 noNetwork(t);
 for(const partial of [false,true]){
  const f=masterFixture(2);const route=await automaticE2PayRoute(f.database,f.env,input(f));
  f.channelSnapshot=route.snapshot;
  if(partial)f.database.sqlite.prepare("UPDATE disbursement_execution_items SET status='SUCCEEDED',attempt_count=1 WHERE id='XI-1'").run();
  const result=await executeCanonicalE2Pay({...f,env:{...f.env,E2PAY_SOURCE_ID:'DIFFERENT-SOURCE'}});
  assert.equal(result.code,'MASTER_ROUTING_SOURCE_CHANGED');
  assert.equal(result.parentStatus,partial?'RECONCILIATION_REQUIRED':'FAILED');assert.equal(result.financialPostStarted,partial);
 }
});
