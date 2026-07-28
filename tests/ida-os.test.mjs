import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTsModule(relativePath, injected = {}) {
  const source = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const require = (specifier) => {
    if (specifier === './worker-registry') return injected.workerRegistry;
    if (specifier === './contracts') return {};
    if (specifier === '../payroll-validate') return injected.payrollValidation;
    throw new Error(`Unexpected import ${specifier}`);
  };
  new Function('exports', 'require', compiled)(exports, require);
  return exports;
}

test('worker isolation rejects tables outside its domain', async () => {
  const registry = await loadTsModule('src/lib/ida-os/worker-registry.ts');
  assert.equal(registry.assertWorkerTableAccess('PAYROLL', ['payrolls', 'payroll_lines']).allowed, true);
  const denied = registry.assertWorkerTableAccess('PAYROLL', ['employees', 'invoices']);
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.denied, ['employees', 'invoices']);
});

test('read executor rejects financial plans', async () => {
  const registry = await loadTsModule('src/lib/ida-os/worker-registry.ts');
  const readWorkers = await loadTsModule('src/lib/ida-os/read-workers.ts', {
    workerRegistry: registry,
    payrollValidation: { validatePayrollIndonesia: () => ({}) },
  });
  assert.throws(
    () => readWorkers.executeReadOnlyPlan({ risk: 'FINANCIAL', tasks: [] }, {}),
    /menolak plan FINANCIAL/
  );
});

test('compliance worker returns deterministic evidence', async () => {
  const registry = await loadTsModule('src/lib/ida-os/worker-registry.ts');
  const readWorkers = await loadTsModule('src/lib/ida-os/read-workers.ts', {
    workerRegistry: registry,
    payrollValidation: {
      validatePayrollIndonesia: () => ({
        ok: false,
        errorCount: 2,
        warningCount: 1,
        infoCount: 0,
        issues: [
          { severity: 'error', message: 'NIK invalid' },
          { severity: 'error', message: 'Rekening kosong' },
          { severity: 'warning', message: 'Email kosong' },
        ],
      }),
    },
  });
  const result = readWorkers.executeReadOnlyPlan({
    risk: 'READ',
    tasks: [{
      worker: 'COMPLIANCE',
      context: { payrollPeriod: '2026-07' },
    }],
  }, {});
  assert.equal(result.worker, 'COMPLIANCE');
  assert.equal(result.errors.length, 2);
  assert.equal(result.evidence[0].service, 'validatePayrollIndonesia');
  assert.equal(result.requiresConfirmation, false);
});

test('destructive action only allows SUPER_ADMIN', async () => {
  const registry = await loadTsModule('src/lib/ida-os/worker-registry.ts');
  assert.equal(registry.validateWorkerTask('HR', 'update_employee', 'HR', 'DESTRUCTIVE').allowed, false);
  assert.equal(registry.validateWorkerTask('HR', 'update_employee', 'SUPER_ADMIN', 'DESTRUCTIVE').allowed, true);
});

test('orchestrator routes financial actions to preview with confirmation', async () => {
  const registry = await loadTsModule('src/lib/ida-os/worker-registry.ts');
  const orchestrator = await loadTsModule('src/lib/ida-os/orchestrator.ts', { workerRegistry: registry });
  const context = orchestrator.buildSharedContext({
    meta: { currentPeriod: '2026-07', orgName: 'ProQPay Lite' },
    payrolls: [{ id: 'PAY-1', period: '2026-07', status: 'CALCULATED' }],
  });
  const result = orchestrator.orchestrateRequest('buat payment instruction', context);
  assert.equal(result.allowed, true);
  assert.equal(result.plan.tasks[0].worker, 'OPERATIONS');
  assert.equal(result.plan.risk, 'FINANCIAL');
  assert.equal(result.plan.stage, 'PREVIEW');
  assert.equal(result.plan.requiresConfirmation, true);
  assert.equal(result.plan.confirmationPhrase, 'KONFIRMASI PAYMENT');
});

test('orchestrator does not route calculations to an LLM worker', async () => {
  const registry = await loadTsModule('src/lib/ida-os/worker-registry.ts');
  const orchestrator = await loadTsModule('src/lib/ida-os/orchestrator.ts', { workerRegistry: registry });
  const context = orchestrator.buildSharedContext({ meta: { currentPeriod: '2026-07' }, payrolls: [] });
  const result = orchestrator.orchestrateRequest('hitung payroll Juli 2026', context);
  assert.equal(result.plan.tasks[0].worker, 'PAYROLL');
  assert.equal(result.plan.tasks[0].capability, 'calculate_payroll');
  assert.equal(result.plan.risk, 'FINANCIAL');
});

test('plan id is idempotent for the same user, context, and request', async () => {
  const registry = await loadTsModule('src/lib/ida-os/worker-registry.ts');
  const orchestrator = await loadTsModule('src/lib/ida-os/orchestrator.ts', { workerRegistry: registry });
  const context = orchestrator.buildSharedContext({ meta: { currentPeriod: '2026-07' }, payrolls: [] });
  const first = orchestrator.orchestrateRequest('validasi payroll', context);
  const second = orchestrator.orchestrateRequest('validasi payroll', context);
  assert.equal(first.plan.id, second.plan.id);
  assert.equal(first.plan.requiresConfirmation, false);
});

test('workflow blocks execution without evidence and exact confirmation', async () => {
  const workflow = await loadTsModule('src/lib/ida-os/workflow.ts');
  const context = {
    organization: { name: 'ProQPay Lite' },
    currentUser: { email: 'admin@proqpay.id' },
    currentRole: 'SUPER_ADMIN',
  };
  const plan = {
    tasks: [{ worker: 'OPERATIONS' }],
    requiresConfirmation: true,
    confirmationPhrase: 'KONFIRMASI PAYMENT',
  };
  const result = {
    worker: 'OPERATIONS',
    facts: ['Payroll PAY-1 berstatus APPROVED'],
    warnings: [],
    errors: [],
    evidence: [],
  };
  const decision = workflow.reconcileWorkerResults(plan, [result], context, 'iya');
  assert.equal(decision.executable, false);
  assert.match(decision.blockers.join(' '), /evidence/i);
  assert.match(decision.blockers.join(' '), /KONFIRMASI PAYMENT/);
});
