import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseUatInquiry} from '../functions/api/e2pay-inquiry-diagnostic-core.js';

test('UAT diagnostic compares baseline and payroll without a financial request or leaking secrets',async()=>{
 const calls=[],audits=[];
 const env={E2PAY_ENV:'UAT',E2PAY_CLIENT_ID:'client',E2PAY_CLIENT_SECRET:'secret',E2PAY_USERNAME:'user',E2PAY_PASSWORD_MD5:'A'.repeat(32),__e2payAudit:async a=>audits.push(a)};
 Object.defineProperty(env,'__e2payAudit',{writable:false});
 const result=await diagnoseUatInquiry(env,5731589,async(url,init)=>{
  const u=new URL(url);calls.push(u.pathname);
  if(u.pathname.endsWith('/authorization/'))return Response.json({code:'private-code'});
  if(u.pathname.endsWith('/token'))return Response.json({access_token:'private-token'});
  assert.equal(init.method,'GET');assert.ok(u.pathname.endsWith('/inquiry'));
  return u.searchParams.get('amount')==='15000'?Response.json({id:'private-inquiry'}):Response.json({code:'99',errors:[{errorMessage:'Amount exceeds limit secret 701075327'}]},{status:400});
 });
 assert.equal(calls.length,4);assert.equal(result.results[0].ok,true);
 assert.equal(result.results[1].diagnostic.reason,'AMOUNT_REJECTED');
 assert.equal(result.financialPostStarted,false);
 assert.doesNotMatch(JSON.stringify({result,audits}),/private-token|private-code|private-inquiry|Amount exceeds/);
 assert.doesNotMatch(JSON.stringify(result),/701075327/);
 for(const row of audits.filter(row=>row.endpoint.endsWith('/inquiry'))){assert.equal(row.queryParameters.accountId,'701075327');assert.equal(row.queryParameters.bankId,'permata');}
});

test('diagnostic rejects production and invalid amounts before any network access',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;};
 await assert.rejects(()=>diagnoseUatInquiry({E2PAY_ENV:'PRODUCTION'},15000,fetchImpl),{code:'E2PAY_DIAGNOSTIC_UAT_ONLY'});
 for(const value of [0,-1,1.5,'15000',NaN,1000000001])await assert.rejects(()=>diagnoseUatInquiry({E2PAY_ENV:'UAT'},value,fetchImpl),{code:'E2PAY_DIAGNOSTIC_AMOUNT_INVALID'});
 assert.equal(calls,0);
});
