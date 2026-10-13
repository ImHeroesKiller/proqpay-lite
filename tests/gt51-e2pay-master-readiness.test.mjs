import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api=readFileSync(new URL('../functions/api/e2pay-operations.js',import.meta.url),'utf8');

test('GT5.1 exposes an authenticated master-only readiness resource',()=>{
  assert.match(api,/\['overview','account','catalog','master-readiness'\]/);
  const block=api.slice(api.indexOf("if(resource==='master-readiness')"),api.indexOf("if(resource==='catalog')"));
  assert.ok(block.length>100);
  assert.match(block,/mode:'MASTER_ACCOUNT'/);
  assert.match(block,/MASTER_BALANCE_STALE/);
  assert.match(block,/MASTER_CREDENTIAL_NOT_CONFIGURED/);
  assert.match(block,/MASTER_EXECUTION_CONTRACT_INVALID/);
  assert.match(block,/e2payExecutionContract/);
  assert.doesNotMatch(block,/d1Run\(|d1Batch\(|liveAccount\(|scopedE2PayRuntimeEnv\(|e2payDisburse\(/);
});
