import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { masterFundingReadiness } from '../functions/api/e2pay-master-funding.js';

const api=readFileSync(new URL('../functions/api/e2pay-operations.js',import.meta.url),'utf8');

test('GT5.1 exposes an authenticated master-only readiness resource',()=>{
  assert.match(api,/\['overview','account','catalog','master-readiness','master-activation'\]/);
  const block=api.slice(api.indexOf("if(resource==='master-readiness')"),api.indexOf("if(resource==='catalog')"));
  assert.ok(block.length>100);
  assert.match(block,/mode:'MASTER_ACCOUNT'/);
  assert.match(block,/masterFundingReadiness/);
  assert.match(block,/e2payExecutionContract/);
  assert.doesNotMatch(block,/d1Run\(|d1Batch\(|liveAccount\(|scopedE2PayRuntimeEnv\(|e2payDisburse\(/);
});
test('GT5.1 master liquidity fails closed without credential, fresh balance or contract',()=>{
  const nowMs=Date.parse('2026-10-13T13:50:00Z');
  const snapshot={balance:100,refreshed_at:'2026-10-13T13:49:00Z'};
  const check=(overrides={})=>masterFundingReadiness({snapshot,credentialConfigured:true,executionContractValid:true,requiredAmount:20,nowMs,...overrides});
  assert.equal(check().ready,true);
  assert.equal(check({credentialConfigured:false}).state,'MASTER_CREDENTIAL_NOT_CONFIGURED');
  assert.equal(check({snapshot:null}).state,'MASTER_BALANCE_NOT_SYNCED');
  assert.equal(check({snapshot:{balance:100,refreshed_at:'2026-10-13T13:30:00Z'}}).state,'MASTER_BALANCE_STALE');
  assert.equal(check({executionContractValid:false}).state,'MASTER_EXECUTION_CONTRACT_INVALID');
  assert.equal(check({requiredAmount:101}).state,'MASTER_BALANCE_INSUFFICIENT');
  assert.equal(check({snapshot:{balance:null,refreshed_at:'2026-10-13T13:49:00Z'}}).state,'MASTER_BALANCE_INVALID');
});
