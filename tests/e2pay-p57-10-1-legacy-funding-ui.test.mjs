import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const fundingUi=await readFile(new URL('../src/components/E2PayFundingLimitControl.tsx',import.meta.url),'utf8');
const directory=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const fundingApi=await readFile(new URL('../functions/api/e2pay-disbursement-limits.js',import.meta.url),'utf8');
test('GT5 Master funding is a single account with per-client limit ownership',()=>{
 assert.match(fundingUi,/Balance Master &amp; Limit Klien/);
 assert.match(fundingUi,/clientId/);
 assert.match(fundingUi,/Refresh Saldo Master/);
 assert.match(fundingUi,/Ajukan ke Controller/);
 assert.match(fundingUi,/Setujui/);
 assert.doesNotMatch(fundingUi,/recoveryAccountId|syncE2PaySubAccountBalance|Register Project Override/);
});
test('GT5 Client/Project detail never requests scoped credential recovery',()=>{
 assert.match(directory,/Master E2Pay/);
 assert.doesNotMatch(directory,/recoveryAccountId|e2payOtp|Legacy credential recovery/);
});
test('GT5 existing limit schema and Controller approval are reused',()=>{
 assert.match(fundingApi,/MASTER_GLOBAL_CAPACITY_RECHECK_FAILED/);
 assert.match(fundingApi,/actor.role!=='PAYROLL_CONTROLLER'/);
});
