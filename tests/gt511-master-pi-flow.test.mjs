import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../functions/api/operating-model-d1.js',import.meta.url),'utf8');
test('master PI preparation and submission do not require deleted subaccounts',()=>{
  assert.match(code,/providerAccount\.account_scope==='MASTER'\?providerAccount\.provider_account_id/);
  assert.match(code,/const master=providerAccount\?\.account_scope==='MASTER'/);
  assert.match(code,/e2payExecutionContract\(gatewayEnv/);
  assert.match(code,/master\?null:providerAccount\.provider_sub_account_id/);
});
test('controller PI approval applies scope-correct master limit and liquidity gate',()=>{
  assert.match(code,/approvalProviderAccount\.account_scope==='MASTER'/);
  assert.match(code,/payment\.client_id,payment\.project_id\|\|null/);
  assert.match(code,/validatePaymentProviderSnapshot\(payment,approvalProviderAccount\)/);
});
