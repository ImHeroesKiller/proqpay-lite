import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const execute=readFileSync(new URL('../functions/api/disbursement-executions.js',import.meta.url),'utf8');
test('canonical payment execution uses Master gateway env and never requires deleted subcredential',()=>{
  assert.match(execute,/const isMaster=account\.account_scope==='MASTER'/);
  assert.match(execute,/e2payExecutionContract\(runtime,\{accountId:account\.provider_account_id\}\)/);
  assert.match(execute,/const routedEnv=isMaster\?runtime:await scopedE2PayRuntimeEnv/);
  assert.match(execute,/liquidityBalance:isMaster\?funding\.parent\.balance/);
  assert.match(execute,/dr\.client_id,dr\.project_id\|\|null/);
});
