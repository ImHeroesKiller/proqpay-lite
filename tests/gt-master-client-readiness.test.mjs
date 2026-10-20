import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveClientReadiness} from '../functions/api/client-readiness-core.js';
const active={clientStatus:'ACTIVE',employeeCount:214,payrollCount:1,masterAccountStatus:'ACTIVE',masterAccountScope:'MASTER',masterCredentialReady:true};
test('Master E2Pay readiness does not depend on retired sub-client provisioning',()=>{
 const r=deriveClientReadiness(active);
 assert.equal(r.payment.ready,true);
 assert.equal(r.payment.state,'READY');
});
test('fail closed on master account or credentials missing',()=>{
 for(const partial of [{masterAccountStatus:'DRAFT'},{masterAccountScope:'CLIENT'},{masterCredentialReady:false},{clientStatus:'INACTIVE'}]){
  assert.equal(deriveClientReadiness({...active,...partial}).payment.ready,false);
 }
});
test('client readiness endpoint reads organization Master scope, not subclient',()=>{
 const src=readFileSync(new URL('../functions/api/client-readiness.js',import.meta.url),'utf8');
 assert.match(src,/account_scope='MASTER'/);
 assert.doesNotMatch(src,/provider_sub_account_id/);
 assert.match(src,/masterCredentialReady:masterCredentialReady/);
});
test('funding and payment rules remain separate',()=>{
 const src=readFileSync(new URL('../functions/api/e2pay-disbursement-limit-core.js',import.meta.url),'utf8');
 assert.match(src,/limitState==='AVAILABLE'/);
 assert.match(src,/parentState==='READY'/);
});
