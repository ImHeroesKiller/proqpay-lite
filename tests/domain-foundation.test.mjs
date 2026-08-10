import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(relativePath, injected = {}) {
  const source = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const require = (specifier) => {
    if (specifier in injected) return injected[specifier];
    throw new Error(`Unexpected import ${specifier}`);
  };
  new Function('exports', 'require', compiled)(exports, require);
  return exports;
}

test('service plan resolves capability and preserves effective-date history', async () => {
  const plans = await load('src/lib/domain/service-plan.ts');
  const history = [
    { id: 'SP1', clientId: 'C1', tier: 'TIER_1_PAYMENT_PROCESSING', status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveUntil: '2026-06-30' },
    { id: 'SP2', clientId: 'C1', tier: 'TIER_2_MANAGED_PAYROLL', status: 'ACTIVE', effectiveFrom: '2026-07-01' },
  ];
  assert.equal(plans.resolveEffectiveServicePlan(history, 'C1', '2026-05-01').id, 'SP1');
  const current = plans.resolveEffectiveServicePlan(history, 'C1', '2026-08-01');
  assert.equal(current.id, 'SP2');
  assert.equal(plans.hasCapability(current, 'PAYROLL_CALCULATION'), true);
  assert.equal(plans.capabilitiesForTier('TIER_1_PAYMENT_PROCESSING').has('PAYROLL_CALCULATION'), false);
});

test('tier-aware workflow blocks calculation for Tier 1 and blocking exceptions', async () => {
  const servicePlan = await load('src/lib/domain/service-plan.ts');
  const workflow = await load('src/lib/domain/payroll-workflow.ts', { './service-plan': servicePlan });
  const tierOne = workflow.validateWorkflowTransition({
    from: 'DATA_APPROVED', to: 'PAYROLL_FINALIZED', actorRole: 'PAYROLL_CONTROLLER',
    tier: 'TIER_1_PAYMENT_PROCESSING', blockingExceptions: 0,
  });
  assert.equal(tierOne.allowed, false);
  assert.match(tierOne.blockers.join(' '), /PAYROLL_CALCULATION/);
  const blocked = workflow.validateWorkflowTransition({
    from: 'CONTROLLER_REVIEW', to: 'DATA_APPROVED', actorRole: 'PAYROLL_CONTROLLER',
    tier: 'TIER_2_MANAGED_PAYROLL', blockingExceptions: 2,
  });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.blockers.join(' '), /2 exception/);
});

test('billing engine fails closed and explains Indomarco fee provenance', async () => {
  const billing = await load('src/lib/domain/billing-engine.ts');
  const input = { clientId: 'INDOMARCO', servicePlanId: 'SP2', period: '2025-10', employeeCount: 99, payrollTotal: 340_978_345 };
  assert.deepEqual(billing.calculateBilling(null, input), { ok: false, error: 'Billing rule belum dikonfigurasi untuk client ini.' });
  const result = billing.calculateBilling({
    id: 'BR1', clientId: 'INDOMARCO', servicePlanId: 'SP2', method: 'PER_EMPLOYEE',
    value: 125_500, taxRate: 0, effectiveFrom: '2025-01-01', version: 'v1',
  }, input);
  assert.equal(result.ok, true);
  assert.equal(result.subtotal, 12_424_500);
  assert.equal(result.formula, 'employeeCount × feePerEmployee');
  assert.equal(result.ruleId, 'BR1');
});

test('payment maker-checker and reconciliation invariants are deterministic', async () => {
  const payment = await load('src/lib/domain/payment-engine.ts');
  assert.equal(payment.validateMakerChecker('USER-1', 'USER-1').allowed, false);
  assert.equal(payment.validateMakerChecker('USER-1', 'USER-2').allowed, true);
  const matched = payment.reconcilePayment(300, [{ amount: 100 }, { amount: 200 }], [{ amount: 300 }]);
  assert.equal(matched.status, 'MATCHED');
  const mismatch = payment.reconcilePayment(300, [{ amount: 290 }], [{ amount: 290 }]);
  assert.equal(mismatch.status, 'PARTIAL');
  assert.equal(mismatch.instructionDifference, -10);
});

test('Tier 3 connector abstraction can sync through a mock', async () => {
  const integration = await load('src/lib/domain/integration.ts');
  const connector = new integration.MockPayrollConnector([
    { sourceId: '1', payload: { employee: 'Ani' }, receivedAt: '2026-08-10T00:00:00Z' },
  ]);
  assert.equal((await connector.testConnection()).ok, true);
  assert.equal((await connector.sync()).records.length, 1);
});
