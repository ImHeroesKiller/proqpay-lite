import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ops=readFileSync(new URL('../functions/api/e2pay-operations.js',import.meta.url),'utf8');
const limit=readFileSync(new URL('../functions/api/e2pay-disbursement-limits.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../functions/api/e2pay-disbursement-limit-core.js',import.meta.url),'utf8');
const dr=readFileSync(new URL('../functions/api/disbursement-requests.js',import.meta.url),'utf8');

test('master registry bootstrap requires provider identity plus recent MFA',()=>{
  const s=ops.slice(ops.indexOf("if(action==='BIND_MASTER_ACCOUNT')"),ops.indexOf("if(action==='REFRESH_ACCOUNT')"));
  assert.match(s,/hasRecentMfa/);
  assert.match(s,/e2payMerchantAccount/);
  assert.match(s,/e2payExecutionContract/);
  assert.match(s,/account_scope='MASTER'/);
  assert.doesNotMatch(s,/e2payDisburse|e2payRegisterRequest|DISBURSEMENT_PROCESS/);
});
test('master limit is scoped to client and uses conditional global capacity update',()=>{
  assert.match(limit,/MASTER_LIMIT_CLIENT_REQUIRED/);
  assert.match(limit,/MASTER_GLOBAL_CAPACITY_RECHECK_FAILED/);
  assert.match(limit,/status='ACTIVE' AND client_id=\?/);
  assert.match(limit,/s\.balance >= \(/);
  assert.match(limit,/guarded\?\.meta\?\.changes/);
  assert.match(core,/MASTER_LIMIT_SOURCE_INVALID/);
  assert.match(core,/client_id=\?/);
});
test('canonical routing keeps owner, Master registry and Controller guarded approval',()=>{
  assert.match(dr,/MASTER_ROUTING_CONTRACT_NOT_READY/);
  assert.match(dr,/current\.client_id,current\.project_id\|\|null/);
  assert.match(dr,/account_scope==='MASTER'\?source\.account\.provider_account_id/);
  assert.match(dr,/DISBURSEMENT_MAKER_CHECKER_VIOLATION/);
  assert.match(dr,/MFA_STEP_UP_REQUIRED/);
});
