import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { permissionsForRole, roleHasCapability } from '../shared/authority-matrix.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('P0 client payroll upload uses scoped capability without global import permission',async()=>{
  assert.equal(roleHasCapability('CLIENT_USER','data-intake'),true);
  assert.equal(permissionsForRole('CLIENT_USER').includes('import:write'),false);
  const intake=await read('functions/api/payroll-intake.js');
  assert.match(intake,/roleHasCapability\(authorization\.actor\.role, "data-intake"\)/);
  assert.match(intake,/clientIntakeScopeAllowed/);
  assert.match(intake,/async function resetIntake[\s\S]*clientIntakeScopeAllowed/);
  assert.match(intake,/invalidTransferTargets[\s\S]*clientIntakeScopeAllowed/);
});

test('P0 global period is propagated into payrun, PI and gateway execution surfaces',async()=>{
  const [workspace,operating,actions,api]=await Promise.all([
    read('src/components/UnifiedPayrollWorkspace.tsx'),
    read('src/components/OperatingWorkspace.tsx'),
    read('src/components/PaymentGatewayExecutionActions.tsx'),
    read('src/lib/payment-gateway-api.ts'),
  ]);
  assert.match(workspace,/<OperatingWorkspace mode="payruns" period=\{period\}/);
  assert.match(workspace,/<OperatingWorkspace mode="payments" period=\{period\}/);
  assert.match(operating,/disabled=\{Boolean\(period && period !== 'ALL'\)\}/);
  assert.match(operating,/PaymentGatewayExecutionActions/);
  assert.match(operating,/expectedPeriod=\{String\(detail\.paymentInstruction\.payroll_period \|\| period\)\}/);
  assert.match(actions,/expectedPeriod/);
  assert.match(api,/payrollPeriod/);
});

test('P0 gateway backend fails closed when financial action period context is missing or mismatched',async()=>{
  const [gateway,hosted]=await Promise.all([
    read('functions/api/payment-gateway.js'),
    read('functions/api/payment-gateway-hosted.js'),
  ]);
  for(const source of [gateway,hosted]){
    assert.match(source,/PAYMENT_PERIOD_CONTEXT_REQUIRED/);
    assert.match(source,/PAYMENT_PERIOD_CONTEXT_INVALID/);
    assert.match(source,/PAYMENT_PERIOD_CONTEXT_MISMATCH/);
    assert.match(source,/payroll_period/);
  }
});
