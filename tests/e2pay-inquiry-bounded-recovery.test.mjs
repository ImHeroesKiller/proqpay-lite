import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFixture,roleSession} from './helpers/e2pay-master-fixture.mjs';
import {executeCanonicalE2Pay} from '../functions/api/disbursement-execution-e2pay.js';
import {onRequest,closeInterruptedExecution} from '../functions/api/disbursement-executions.js';
import {e2payInquiry,e2payInquirySignature} from '../functions/api/payment-gateway-e2pay.js';
import {encryptAccountNumber} from '../functions/api/payment-instruction-core.js';

async function inquiryFixture(count){
 const f=masterFixture(count);
 f.database.sqlite.exec("UPDATE disbursement_requests SET status='DRAFT'");
 const bank=await encryptAccountNumber('701075327',f.env.PI_ENCRYPTION_KEY);
 f.database.sqlite.prepare('UPDATE disbursement_request_items SET account_number_ciphertext=?,account_number_iv=?').run(bank.ciphertext,bank.iv);
 f.database.sqlite.exec("UPDATE disbursement_requests SET status='PROCESSING'; UPDATE disbursement_execution_items SET status='CREATED',inquiry_id=NULL");
 f.requestItems=f.database.sqlite.prepare('SELECT * FROM disbursement_request_items ORDER BY sequence_no').all();
 return f;
}
function provider(t,{reject=false,network=false,mismatch=false}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const u=new URL(url);calls.push(u.pathname);
  if(u.pathname.endsWith('/authorization/'))return Response.json({code:'code'});
  if(u.pathname.endsWith('/token'))return Response.json({access_token:'token'});
  if(u.pathname.endsWith('/account'))return Response.json({accountId:'PROVIDER-MASTER',merchantStatus:'ACTIVE',balance:1e9});
  if(u.pathname.endsWith('/bank/sdp'))return Response.json({data:[{id:'bca',name:'BCA'},{id:'permata',name:'Permata'}]});
  if(u.pathname.endsWith('/inquiry')){
   if(network)throw new Error('Too many subrequests. secret-account-701075327');
   if(reject)return Response.json({code:'99',message:'Invalid signature for secret-account-701075327',access_token:'private-token'},{status:400});
   return Response.json({id:'INQ-'+calls.length,accountId:u.searchParams.get('accountId'),amount:Number(u.searchParams.get('amount')),bankId:mismatch?'wrong-bank':u.searchParams.get('bankId'),feeAmount:0,name:'Test'});
  }
  if(u.pathname.endsWith('/transaction')){assert.equal(init.method,'POST');return Response.json({responseCode:'00',journalId:'J-'+calls.length});}
  throw new Error('Unexpected path');
 });
 return {calls,inquiries:()=>calls.filter(p=>p.endsWith('/inquiry')).length,posts:()=>calls.filter(p=>p.endsWith('/sdp/transaction')).length};
}

test('E2Pay documented signature vector and actual inquiry wire contract match pages 29–31',async()=>{
 const secret='BhZnzaqtxmx5KIylFySotj03ENdf3PTc';
 assert.equal(await e2payInquirySignature(secret,'701075327','permata',15000),'M0SjiDTLke5S5IQ+QLXy/WVcADGLMlqpU8LCrI34Blc=');
 await e2payInquiry({E2PAY_CLIENT_SECRET:secret},'test-token',{accountId:'701075327',bankId:'permata',amount:15000},async(url,init)=>{
  const u=new URL(url);assert.equal(u.pathname,'/switching/b2b/merchant/me/sdp/inquiry');
  assert.equal(u.searchParams.toString(),'accountId=701075327&bankId=permata&amount=15000');
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,'Bearer test-token');
  assert.equal(init.headers.Signature,'M0SjiDTLke5S5IQ+QLXy/WVcADGLMlqpU8LCrI34Blc=');
  return Response.json({id:'inquiry'});
 });
});

test('inquiry diagnostics classify nested provider errors without exposing provider text',async()=>{
 for(const [body,reason] of [
  [{code:'99',errorMessage:'Invalid signature secret-701075327'},'SIGNATURE_REJECTED'],
  [{code:'99',errors:[{detail:'Amount exceeds maximum secret-701075327'}]},'AMOUNT_REJECTED'],
  [{code:'99',error:{message:'Otentikasi user gagal secret-701075327'}},'AUTH_REJECTED'],
 ]){
  const audits=[];
  await assert.rejects(()=>e2payInquiry({E2PAY_CLIENT_SECRET:'secret',__e2payAudit:async a=>audits.push(a)},'token',{accountId:'701075327',bankId:'permata',amount:15000},async()=>Response.json(body,{status:400})),new RegExp(reason));
  assert.equal(audits[0].responseDiagnostics.reason,reason);
  assert.ok(!JSON.stringify(audits).includes('secret-701075327'));
 }
});

test('214 beneficiaries resume bounded inquiry batches without financial POST before all pass',async t=>{
 const f=await inquiryFixture(214);const p=provider(t);
 let r=await executeCanonicalE2Pay(f);assert.equal(r.statusCode,202);assert.equal(r.phase,'INQUIRY');assert.equal(r.remaining,209);assert.equal(p.inquiries(),5);assert.equal(p.posts(),0);
 for(let i=1;i<43;i++)r=await executeCanonicalE2Pay(f);
 assert.equal(p.inquiries(),214);assert.equal(p.posts(),25);assert.equal(r.remaining,189);
 while(r.hasMore)r=await executeCanonicalE2Pay(f);
 assert.equal(r.parentStatus,'SUCCEEDED');assert.equal(p.posts(),214);
 await executeCanonicalE2Pay(f);assert.equal(p.posts(),214);
});

for(const kind of ['reject','network'])test(`first ${kind} stops preflight, persists failure and never probes again`,async t=>{
 const f=await inquiryFixture(214);const p=provider(t,{[kind]:true});const audits=[];f.env.__e2payAudit=async e=>audits.push(structuredClone(e));
 const r=await executeCanonicalE2Pay(f);assert.equal(r.parentStatus,'FAILED');assert.equal(p.inquiries(),1);assert.equal(p.posts(),0);
 const rows=f.database.sqlite.prepare('SELECT * FROM disbursement_execution_items').all();assert.equal(rows.filter(x=>x.status==='CREATED').length,213);
 const failed=rows.find(x=>x.status==='FAILED');assert.ok(!failed.error_message.includes('701075327'));assert.equal(failed.error_code,kind==='network'?'E2PAY_SUBREQUEST_LIMIT':'E2PAY_HTTP_ERROR');
 const a=audits.find(x=>x.endpoint.endsWith('/inquiry'));assert.ok(!JSON.stringify(a).includes('701075327'));assert.ok(!JSON.stringify(a).includes('private-token'));
 if(kind==='reject'){assert.equal(a.responseDiagnostics.providerCode,'99');assert.equal(a.responseDiagnostics.reason,'SIGNATURE_REJECTED');assert.equal(a.responseDiagnostics.bodyFingerprint.length,64);}
 await executeCanonicalE2Pay(f);assert.equal(p.inquiries(),1);assert.equal(p.posts(),0);
});

test('interruption with no financial attempt closes DR and ledger; financial attempts require reconciliation',async()=>{
 for(const attempts of [0,1]){
  const f=masterFixture();f.database.sqlite.prepare('UPDATE disbursement_execution_items SET attempt_count=?').run(attempts);
  const r=await closeInterruptedExecution(f.database,f.execution,f.request,{email:'controller@test',role:'PAYROLL_CONTROLLER'},'ORG-FIX');
  assert.equal(r.status,attempts?'RECONCILIATION_REQUIRED':'FAILED');
  assert.equal(f.database.sqlite.prepare('SELECT status FROM disbursement_requests').get().status,r.status);
  assert.equal(f.database.sqlite.prepare('SELECT status FROM disbursement_executions').get().status,r.status);
 }
});

test('stale recovery is Controller/MFA gated, rejects active workers, and performs zero provider calls',async t=>{
 const f=masterFixture();f.env.SECURITY_MFA_ENFORCEMENT='ENFORCE';let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('PROVIDER MUST NOT BE CALLED');});
 const request=async (role,mfa=true)=>onRequest({env:f.env,request:new Request('https://proqpay.test/api/disbursement-executions',{method:'POST',headers:await roleSession(f,role,{mfa}),body:JSON.stringify({action:'RECOVER_INTERRUPTED',disbursementRequestId:'DR-FIX'})})});
 assert.equal((await request('PAYROLL_PROCESSOR')).status,403);
 assert.equal((await request('PAYROLL_CONTROLLER',false)).status,428);
 assert.equal((await request('PAYROLL_CONTROLLER')).status,409);
 f.database.sqlite.exec("UPDATE disbursement_executions SET updated_at=datetime('now','-10 minutes'),execution_lock_token='old',execution_lock_expires_at=datetime('now','-8 minutes'); UPDATE disbursement_requests SET status='EXECUTING'");
 const r=await request('PAYROLL_CONTROLLER');assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).status,'FAILED');assert.equal(calls,0);
 assert.equal((await request('PAYROLL_CONTROLLER')).status,409);
});


test('inquiry bank mismatch cannot become transfer-ready',async t=>{
 const f=await inquiryFixture(1);const p=provider(t,{mismatch:true});
 const r=await executeCanonicalE2Pay(f);assert.equal(r.parentStatus,'FAILED');assert.equal(p.posts(),0);
 assert.equal(f.database.sqlite.prepare('SELECT error_code FROM disbursement_execution_items').get().error_code,'E2PAY_INQUIRY_CONTROL_MISMATCH');
});
