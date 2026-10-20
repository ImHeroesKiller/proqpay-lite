import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFixture,mockProvider,roleSession} from './helpers/e2pay-master-fixture.mjs';
import {executeCanonicalE2Pay} from '../functions/api/disbursement-execution-e2pay.js';
import {reconciliationE2PayRuntimeEnv} from '../functions/api/payment-provider-account-credentials.js';
import {onRequest as register} from '../functions/api/canonical-transaction-register.js';
import {onRequest as operations} from '../functions/api/e2pay-operations.js';
import {onRequest as limits} from '../functions/api/e2pay-disbursement-limits.js';
import {assertReviewedPagesProject} from '../scripts/verify-pages-release-control.mjs';

const executionRow=f=>f.database.sqlite.prepare("SELECT * FROM disbursement_executions WHERE id='DX-FIX'").get();
const requestRow=f=>f.database.sqlite.prepare("SELECT * FROM disbursement_requests WHERE id='DR-FIX'").get();
const items=f=>f.database.sqlite.prepare('SELECT * FROM disbursement_execution_items ORDER BY id').all();

test('Master execution persists successful results, completes chunks and never reposts a settled item',async t=>{
 const f=masterFixture(2);const provider=mockProvider(t);f.env.E2PAY_SYNC_BENEFICIARY_LIMIT=1;
 let r=await executeCanonicalE2Pay(f);
 assert.equal(r.parentStatus,'PROCESSING');assert.equal(r.remaining,1);assert.equal(provider.posts().length,1);
 r=await executeCanonicalE2Pay(f);assert.equal(r.parentStatus,'SUCCEEDED');assert.equal(provider.posts().length,2);assert.ok(executionRow(f).completed_at);
 await executeCanonicalE2Pay(f);assert.equal(provider.posts().length,2);
 const refs=provider.posts().map(c=>JSON.parse(c.body).clientRef);assert.equal(new Set(refs).size,2);
});

for(const payment of ['invalid-json','timeout'])test(`Master ${payment} holds UNKNOWN and requires history before any retry`,async t=>{
 const f=masterFixture();const provider=mockProvider(t,{payment});
 const result=await executeCanonicalE2Pay(f);
 assert.equal(result.parentStatus,'RECONCILIATION_REQUIRED');assert.equal(items(f)[0].status,'UNKNOWN');
 await executeCanonicalE2Pay(f);assert.equal(provider.posts().length,1);
});

test('Result persistence failure retains UNKNOWN and blocks financial replay',async t=>{
 const f=masterFixture();const provider=mockProvider(t);const original=f.database.batch.bind(f.database);let failed=false;
 f.database.batch=async stmts=>{if(!failed&&stmts.some(s=>s.bindings?.[0]==='SUCCEEDED')){failed=true;throw new Error('SIMULATED_DISK_FAILURE');}return original(stmts)};
 const result=await executeCanonicalE2Pay(f);assert.equal(result.parentStatus,'RECONCILIATION_REQUIRED');assert.equal(items(f)[0].status,'UNKNOWN');
 await executeCanonicalE2Pay(f);assert.equal(provider.posts().length,1);
});

test('Expired execution lock prevents financial send and atomic item claim prevents a second send',async t=>{
 const f=masterFixture();const provider=mockProvider(t);
 await assert.rejects(executeCanonicalE2Pay({...f,assertExecutionLock:async()=>{throw new Error('LOCK_LOST')}}),/LOCK_LOST/);
 assert.equal(provider.posts().length,0);assert.equal(items(f)[0].attempt_count,0);
 // Simulate another worker claiming the item between selection and claim.
 await executeCanonicalE2Pay({...f,assertExecutionLock:async()=>{f.database.sqlite.prepare("UPDATE disbursement_execution_items SET status='PENDING',attempt_count=1").run()}});
 assert.equal(provider.posts().length,0);
});

test('Master reconciliation uses central credentials and rejects source/environment identity drift',async()=>{
 const f=masterFixture();const account=f.database.sqlite.prepare('SELECT * FROM payment_provider_accounts').get();
 assert.equal(await reconciliationE2PayRuntimeEnv(f.database,f.env,account,f.request),f.env);
 for(const change of [{E2PAY_ENV:'PRODUCTION'},{E2PAY_ACCOUNT_SRC:'OTHER'}])await assert.rejects(reconciliationE2PayRuntimeEnv(f.database,{...f.env,...change},account,f.request),e=>e.code==='MASTER_RECONCILIATION_IDENTITY_MISMATCH');
});

test('Controller history reconciliation closes canonical PI/payroll once; other roles cannot reconcile',async t=>{
 const f=masterFixture();const provider=mockProvider(t,{payment:'invalid-json',history:'00'});await executeCanonicalE2Pay(f);
 for(const role of ['SUPER_ADMIN','PAYROLL_PROCESSOR','CLIENT_USER']){
  const headers=await roleSession(f,role);const response=await register({request:new Request('https://proqpay.test/api/canonical-transaction-register',{method:'POST',headers,body:JSON.stringify({action:'RECONCILE',disbursementRequestId:'DR-FIX'})}),env:f.env});
  assert.equal(response.status,403,await response.clone().text());
 }
 const headers=await roleSession(f,'PAYROLL_CONTROLLER');
 const reconcile=()=>register({request:new Request('https://proqpay.test/api/canonical-transaction-register',{method:'POST',headers,body:JSON.stringify({action:'RECONCILE',disbursementRequestId:'DR-FIX'})}),env:f.env});
 let response=await reconcile();assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).outcome.attemptStatus,'MATCHED');
 assert.equal(requestRow(f).status,'RECONCILED');assert.ok(f.database.sqlite.prepare('SELECT settled_at FROM disbursement_request_items').get().settled_at);
 assert.equal(f.database.sqlite.prepare('SELECT status FROM payment_instructions').get().status,'COMPLETED');
 assert.equal(f.database.sqlite.prepare('SELECT state FROM payroll_submissions').get().state,'COMPLETED');
 response=await reconcile();assert.equal(response.status,200,await response.clone().text());
 assert.equal(f.database.sqlite.prepare('SELECT count(*) n FROM reconciliations').get().n,1);
 assert.equal(provider.posts().length,1);
});

test('Missing history keeps UNKNOWN, reservation and PI pending',async t=>{
 const f=masterFixture();mockProvider(t,{payment:'timeout',history:null});await executeCanonicalE2Pay(f);
 const headers=await roleSession(f,'PAYROLL_CONTROLLER');const response=await register({request:new Request('https://proqpay.test/api/canonical-transaction-register',{method:'POST',headers,body:JSON.stringify({disbursementRequestId:'DR-FIX'})}),env:f.env});
 assert.equal(response.status,200,await response.clone().text());assert.equal(items(f)[0].status,'UNKNOWN');assert.notEqual(f.database.sqlite.prepare('SELECT status FROM payment_instructions').get().status,'COMPLETED');
});

test('Master binding requires Super Admin and live ACTIVE identity; no payment POST',async t=>{
 const f=masterFixture();const provider=mockProvider(t);
 for(const role of ['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER']){
  const headers=await roleSession(f,role);const r=await operations({request:new Request('https://proqpay.test/api/e2pay-operations',{method:'POST',headers,body:'{"action":"BIND_MASTER_ACCOUNT"}'}),env:f.env});assert.equal(r.status,403);
 }
 const headers=await roleSession(f,'SUPER_ADMIN');const r=await operations({request:new Request('https://proqpay.test/api/e2pay-operations',{method:'POST',headers,body:'{"action":"BIND_MASTER_ACCOUNT"}'}),env:f.env});assert.equal(r.status,200,await r.clone().text());assert.equal(provider.posts().length,0);
 const activation=await operations({request:new Request('https://proqpay.test/api/e2pay-operations?resource=master-activation',{headers}),env:f.env});const data=await activation.json();assert.equal(data.registryId,'MASTER-FIX');assert.equal(data.connectionReady,true);
});

test('Release gate rejects automatic deployments, wrong branch and incomplete build command',()=>{
 const safe={production_branch:'main',source:{type:'github',config:{deployments_enabled:false,production_deployments_enabled:false}},build_config:{build_command:'npm run build'}};
 assert.equal(assertReviewedPagesProject(safe),true);
 for(const p of [{...safe,source:{type:'github',config:{deployments_enabled:true}}},{...safe,production_branch:'other'},{...safe,build_config:{build_command:'npx next build'}}])assert.throws(()=>assertReviewedPagesProject(p));
});

test('Processor requests client limit; only a different Controller approves within fresh Master balance',async t=>{
 const f=masterFixture();const provider=mockProvider(t);const admin=await roleSession(f,'SUPER_ADMIN');
 await operations({request:new Request('https://proqpay.test/api/e2pay-operations',{method:'POST',headers:admin,body:'{"action":"BIND_MASTER_ACCOUNT"}'}),env:f.env});
 const processor=await roleSession(f,'PAYROLL_PROCESSOR');const controller=await roleSession(f,'PAYROLL_CONTROLLER');
 const post=(headers,body)=>limits({request:new Request('https://proqpay.test/api/e2pay-disbursement-limits',{method:'POST',headers,body:JSON.stringify(body)}),env:f.env});
 let r=await post(processor,{action:'REQUEST_LIMIT',providerAccountRegistryId:'MASTER-FIX',clientId:'C-FIX',amount:2000,reason:'Test payroll limit'});assert.equal(r.status,201,await r.clone().text());const id=(await r.json()).request.id;
 r=await post(processor,{action:'APPROVE_LIMIT',id});assert.equal(r.status,403);
 r=await post(controller,{action:'APPROVE_LIMIT',id});assert.equal(r.status,200,await r.clone().text());
 assert.equal(f.database.sqlite.prepare('SELECT approved_amount FROM e2pay_disbursement_limit_requests').get().approved_amount,2000);
 assert.equal(provider.posts().length,0);
});

test('Master activation and reconciliation require recent MFA under enforced policy',async()=>{
 const f=masterFixture();f.env.SECURITY_MFA_ENFORCEMENT='ENFORCE';
 for(const [role,handler,path,body] of [['SUPER_ADMIN',operations,'e2pay-operations',{action:'BIND_MASTER_ACCOUNT'}],['PAYROLL_CONTROLLER',register,'canonical-transaction-register',{disbursementRequestId:'DR-FIX'}]]){
  const headers=await roleSession(f,role,{mfa:false});
  const response=await handler({request:new Request('https://proqpay.test/api/'+path,{method:'POST',headers,body:JSON.stringify(body)}),env:f.env});assert.equal(response.status,428,await response.clone().text());
 }
});

test('Master allocation never reuses another client reservation or a debit newer than its balance snapshot',async t=>{
 const {reserveDisbursementRequestLimit,consumeDisbursementRequestLimit}=await import('../functions/api/e2pay-disbursement-limit-core.js');
 const f=masterFixture();mockProvider(t);const admin=await roleSession(f,'SUPER_ADMIN');
 await operations({request:new Request('https://proqpay.test/api/e2pay-operations',{method:'POST',headers:admin,body:'{"action":"BIND_MASTER_ACCOUNT"}'}),env:f.env});
 f.database.sqlite.prepare("UPDATE payment_gateway_provider_snapshots SET balance=2000,refreshed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 seconds')").run();
 f.database.sqlite.prepare("INSERT INTO clients(id,org_id,code,name,status) VALUES('C-SECOND','ORG-FIX','SECOND','Second client','ACTIVE')").run();
 const processor=await roleSession(f,'PAYROLL_PROCESSOR');const controller=await roleSession(f,'PAYROLL_CONTROLLER');
 const post=(headers,body)=>limits({request:new Request('https://proqpay.test/api/e2pay-disbursement-limits',{method:'POST',headers,body:JSON.stringify(body)}),env:f.env});
 let r=await post(processor,{action:'REQUEST_LIMIT',providerAccountRegistryId:'MASTER-FIX',clientId:'C-FIX',amount:2000,reason:'First client limit'});assert.equal(r.status,201,await r.clone().text());const first=(await r.json()).request.id;
 r=await post(controller,{action:'APPROVE_LIMIT',id:first});assert.equal(r.status,200,await r.clone().text());
 assert.equal((await reserveDisbursementRequestLimit(f.database,{organizationId:'ORG-FIX',providerAccountRegistryId:'MASTER-FIX',disbursementRequestId:'DR-FIX',amount:1000})).ok,true);
 r=await post(processor,{action:'REQUEST_LIMIT',providerAccountRegistryId:'MASTER-FIX',clientId:'C-SECOND',amount:1000,reason:'Second client limit'});assert.equal(r.status,201,await r.clone().text());const second=(await r.json()).request.id;
 r=await post(controller,{action:'APPROVE_LIMIT',id:second});assert.equal(r.status,409);assert.equal((await r.json()).code,'MASTER_GLOBAL_CAPACITY_RECHECK_FAILED');
 await consumeDisbursementRequestLimit(f.database,'DR-FIX',1000);
 r=await post(controller,{action:'APPROVE_LIMIT',id:second});assert.equal(r.status,409);assert.equal((await r.json()).code,'MASTER_GLOBAL_CAPACITY_RECHECK_FAILED');
});
