import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePaymentProviderSnapshot,providerSnapshot} from '../functions/api/payment-provider-routing.js';

const account={id:'MASTER-1',org_id:'ORG-1',client_id:null,account_scope:'MASTER',status:'ACTIVE',provider:'E2PAY',environment:'UAT'};
const pi={client_id:'CLIENT-1',provider_account_registry_id:'MASTER-1',provider:'E2PAY',provider_environment:'UAT',provider_sub_account_id:null};

test('master PI requires master registry and matching immutable provider',()=>{
  assert.equal(validatePaymentProviderSnapshot(pi,account).ok,true);
  assert.equal(validatePaymentProviderSnapshot({...pi,provider_account_registry_id:'OTHER'},account).ok,false);
  assert.equal(validatePaymentProviderSnapshot({...pi,provider_sub_account_id:'OLD'},account).code,'PI_MASTER_SUBACCOUNT_FORBIDDEN');
  assert.equal(validatePaymentProviderSnapshot(pi,{...account,status:'INACTIVE'}).ok,false);
  assert.equal(providerSnapshot(account).subAccountLast4,null);
  assert.equal(providerSnapshot(account).accountScope,'MASTER');
});

test('funding code derives liquidity from master provider snapshot, not per-client shadow balance',()=>{
  const code=readFileSync(new URL('../functions/api/e2pay-disbursement-limit-core.js',import.meta.url),'utf8');
  assert.match(code,/account\.account_scope==='MASTER'/);
  assert.match(code,/parentFresh/);
  assert.match(code,/isMaster\?null:account\.id/);
});
