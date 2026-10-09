import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { liquidityState, PROVIDER_BALANCE_MAX_AGE_MS } from '../functions/api/payment-provider-routing.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('liquidity requires a fresh synced balance and enough funds',()=>{
  const now=Date.now();
  assert.equal(liquidityState({status:'ACTIVE',provider_sub_account_id:'SUB-1',available_balance:null,last_balance_sync_at:null},15900000,now).state,'NOT_SYNCED');
  assert.equal(liquidityState({status:'ACTIVE',provider_sub_account_id:'SUB-1',available_balance:20000000,last_balance_sync_at:new Date(now-PROVIDER_BALANCE_MAX_AGE_MS-1).toISOString()},15900000,now).state,'STALE');
  assert.equal(liquidityState({status:'ACTIVE',provider_sub_account_id:'SUB-1',available_balance:10000000,last_balance_sync_at:new Date(now-1000).toISOString()},15900000,now).state,'INSUFFICIENT');
  const funded=liquidityState({status:'ACTIVE',provider_sub_account_id:'SUB-1',available_balance:20000000,last_balance_sync_at:new Date(now-1000).toISOString()},15900000,now);
  assert.equal(funded.state,'FUNDED');
  assert.equal(funded.ready,true);
});

test('Payroll Controller may sync balance but cannot mutate sub-account mapping',async()=>{
  const source=await read('functions/api/e2pay-subaccounts.js');
  assert.match(source,/const controllerSafeActions=new Set\(\['SYNC_BALANCE'\]\)/);
  assert.match(source,/!MANAGE_ROLES\.includes\(actor\.role\) && !controllerSafeActions\.has\(action\)/);
  assert.match(source,/if\(action==='SYNC_BALANCE'\)/);
});

test('PI detail exposes live registry balance after sync',async()=>{
  const source=await read('functions/api/operating-model-d1.js');
  assert.match(source,/liveProviderAccount/);
  assert.match(source,/SELECT \* FROM payment_provider_accounts WHERE id=\? AND org_id=\? LIMIT 1/);
  assert.match(source,/availableBalanceSnapshot:liveProviderAccount\?\.available_balance/);
  assert.match(source,/checkedAt:liveProviderAccount\?\.last_balance_sync_at/);
  assert.match(source,/ready:liveProviderAccount\?liquidityState/);
});

test('Controller approval UI syncs E2Pay balance before APPROVE_PAYMENT',async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/syncE2PaySubAccountBalance/);
  assert.match(source,/async function refreshLiquidity/);
  assert.match(source,/await syncE2PaySubAccountBalance\(accountId,Number\(target\.control\.expectedTotal\|\|0\)\)/);
  assert.match(source,/async function approveWithFreshLiquidity/);
  assert.match(source,/current=await refreshLiquidity\(current\)/);
  assert.match(source,/providerLiquidity\?\.ready!==true/);
  assert.match(source,/onClick=\{\(\)=>void approveWithFreshLiquidity\(\)\}/);
  assert.match(source,/Sync Balance E2Pay/);
});

test('approval persists fresh balance evidence and honors project override routing',async()=>{
  const source=await read('functions/api/operating-model-d1.js');
  assert.match(source,/activeProviderAccount\(database,organizationId,submission\.client_id,'E2PAY',providerEnvironment,submission\.project_id\|\|null\)/);
  assert.match(source,/s\.project_id AS project_id/);
  assert.match(source,/activeProviderAccount\(database,organizationId,payment\.client_id,'E2PAY',payment\.provider_environment,payment\.project_id\|\|null\)/);
  assert.match(source,/provider_balance_snapshot=COALESCE\(\?,provider_balance_snapshot\)/);
  assert.match(source,/provider_available_balance_snapshot=COALESCE\(\?,provider_available_balance_snapshot\)/);
  assert.match(source,/provider_balance_checked_at=COALESCE\(\?,provider_balance_checked_at\)/);
  assert.match(source,/liquidity=\$\{approvalLiquidity\.state\}/);
});
