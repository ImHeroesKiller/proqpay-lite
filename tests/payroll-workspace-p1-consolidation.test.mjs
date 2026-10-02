import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('P1 Payroll Workspace persists the business stage in URL and restores on browser history',async()=>{
  const source=await read('src/components/UnifiedPayrollWorkspace.tsx');
  assert.match(source,/stageFromUrl/);
  assert.match(source,/url\.searchParams\.set\('stage',stageMeta\[next\]\.url\)/);
  assert.match(source,/window\.history\.pushState/);
  assert.match(source,/window\.addEventListener\('popstate'/);
  assert.match(source,/step:'1'/);
  assert.match(source,/step:'2'/);
  assert.match(source,/step:'3'/);
});

test('P1 uses one shared period/client/project/search context across all three stages',async()=>{
  const [workspace,operating,billing]=await Promise.all([
    read('src/components/UnifiedPayrollWorkspace.tsx'),
    read('src/components/OperatingWorkspace.tsx'),
    read('src/components/BillingWorkspace.tsx'),
  ]);
  assert.match(workspace,/payroll-shared-filter/);
  assert.match(workspace,/clientId/);
  assert.match(workspace,/projectId/);
  assert.match(workspace,/query/);
  assert.match(workspace,/filters=\{filters\}/);
  assert.match(operating,/projectFilter/);
  assert.match(operating,/embedded/);
  assert.match(billing,/const scopedData = useMemo/);
  assert.match(billing,/periodMatch/);
  assert.match(billing,/projectMatch/);
});

test('P1 consolidates PI and gateway instead of rendering a second gateway queue',async()=>{
  const [workspace,operating]=await Promise.all([
    read('src/components/UnifiedPayrollWorkspace.tsx'),
    read('src/components/OperatingWorkspace.tsx'),
  ]);
  assert.doesNotMatch(workspace,/PaymentGatewayPaymentPanel/);
  assert.match(operating,/PaymentGatewayExecutionActions/);
  assert.match(operating,/PAYMENT EXECUTION/);
  assert.match(operating,/phase==='payment'/);
});

test('P1 places proof and reconciliation only in Reconcile & Close stage',async()=>{
  const [workspace,operating]=await Promise.all([
    read('src/components/UnifiedPayrollWorkspace.tsx'),
    read('src/components/OperatingWorkspace.tsx'),
  ]);
  assert.match(workspace,/mode="reconcile"/);
  assert.match(workspace,/mode="billing"/);
  assert.match(operating,/phase:'payment'\|'reconcile'/);
  assert.match(operating,/phase==='reconcile' \? <PaymentReconciliationControl/);
  assert.match(operating,/phase==='reconcile' \? <>/);
});

test('P1 keeps period context on every E2Pay continuation and returns hosted flow to unified payment stage',async()=>{
  const source=await read('src/components/PaymentGatewayExecutionActions.tsx');
  const seamlessCalls=[...source.matchAll(/executeSeamlessPayment\(paymentInstructionId, 'BANK_TRANSFER', expectedPeriod\)/g)];
  assert.ok(seamlessCalls.length>=2,'initial and continuation calls must both include expectedPeriod');
  assert.match(source,/view=operations/);
  assert.match(source,/stage=payment/);
});
