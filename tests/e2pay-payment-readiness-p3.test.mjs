import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const validation=await readFile(new URL('../functions/api/e2pay-uat-validation.js',import.meta.url),'utf8');
const routing=await readFile(new URL('../functions/api/payment-provider-routing.js',import.meta.url),'utf8');
const api=await readFile(new URL('../src/lib/e2pay-api.ts',import.meta.url),'utf8');

test('P3 readiness uses project-aware override routing',()=>{
  assert.match(validation,/activeProviderAccount\(database,organizationId,submission\.client_id,'E2PAY','UAT',submission\.project_id\)/);
  assert.match(routing,/if\(projectId\)/);
  assert.match(routing,/project_id IS NULL/);
});

test('P3 readiness fails closed on provisioning liquidity and immutable PI snapshot',()=>{
  assert.match(validation,/E2PAY_PROVISIONING_INCOMPLETE/);
  assert.match(validation,/E2PAY_LIQUIDITY_/);
  assert.match(validation,/validatePaymentProviderSnapshot/);
  assert.match(validation,/READINESS_BLOCKED/);
  assert.match(api,/readiness:\{ready:boolean;blockers:/);
});

test('P3 keeps Controller execution authority explicit',()=>{
  assert.match(validation,/financialExecutionRole:'PAYROLL_CONTROLLER'/);
  assert.match(validation,/rawDisbursementDisabled:true/);
  assert.match(validation,/paymentControlOnly:true/);
});
