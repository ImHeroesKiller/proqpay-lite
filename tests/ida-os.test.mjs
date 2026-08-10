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
    if (specifier === './evidence-query') return injected.evidenceQuery || { answerEvidenceQuery: () => null };
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
  }, {
    currentUser: { email: 'finance@proqpay.id' },
    currentRole: 'FINANCE',
    permissions: ['read', 'finance:write'],
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

test('payroll preview and breakdown use only deterministic payroll lines', async () => {
  const preview = await loadTsModule('src/lib/ida-os/payroll-preview.ts');
  const payroll = {
    period: '2026-07',
    summary: {
      employeeCount: 2,
      totalGross: 12_000_000,
      totalDeduction: 600_000,
      totalNet: 11_400_000,
    },
    details: [
      {
        company: 'Client A',
        salaryGross: 5_000_000,
        allowanceTransport: 500_000,
        allowanceMeal: 500_000,
        gross: 6_000_000,
        net: 5_700_000,
        deductionBreakdown: { 'BPJS Kesehatan': 100_000, 'BPJS Ketenagakerjaan': 200_000 },
      },
      {
        company: 'Client A',
        salaryGross: 5_000_000,
        allowanceTransport: 500_000,
        allowanceMeal: 500_000,
        gross: 6_000_000,
        net: 5_700_000,
        deductionBreakdown: { 'BPJS Kesehatan': 100_000, 'BPJS Ketenagakerjaan': 200_000 },
      },
    ],
  };
  const result = preview.buildPayrollPreview(payroll, 3, 'PLAN-1');
  const breakdown = preview.buildPayrollBreakdown(payroll);
  assert.deepEqual(result, {
    planId: 'PLAN-1',
    period: '2026-07',
    employeeCount: 2,
    totalGross: 12_000_000,
    totalDeduction: 600_000,
    totalNet: 11_400_000,
    validationErrors: 3,
  });
  assert.equal(breakdown.components['Gaji pokok'], 10_000_000);
  assert.equal(breakdown.components['Potongan BPJS Kesehatan'], 200_000);
  assert.deepEqual(breakdown.clients['Client A'], { count: 2, gross: 12_000_000, net: 11_400_000 });
});

test('payroll queries return factual readiness, rows, and salary ranking', async () => {
  const query = await loadTsModule('src/lib/ida-os/payroll-query.ts');
  const payroll = {
    status: 'CALCULATED',
    details: [
      { name: 'Budi', company: 'Client A', salaryGross: 4_000_000, gross: 4_200_000, net: 4_000_000 },
      { name: 'Ani', company: 'Client A', salaryGross: 3_000_000, gross: 3_200_000, net: 3_050_000 },
    ],
  };
  assert.deepEqual(query.payrollReadiness(payroll, 2), {
    readyForApproval: true,
    readyForPayment: false,
    reason: '2 error validasi masih memblokir payment instruction.',
  });
  assert.equal(query.payrollEmployeeRows(payroll)[0].deduction, 200_000);
  assert.equal(query.rankPayrollEmployees(payroll, 'LOWEST', 1)[0].name, 'Ani');
  assert.equal(query.rankPayrollEmployees(payroll, 'HIGHEST', 1)[0].name, 'Budi');
});

test('approval requires a preview and is idempotent', async () => {
  const approval = await loadTsModule('src/lib/ida-os/approval-preview.ts');
  const db = {
    payrolls: [{
      id: 'PAY-1',
      period: '2026-07',
      status: 'CALCULATED',
      summary: { employeeCount: 2, totalNet: 10_000_000 },
    }],
    approvals: [],
    auditLogs: [],
  };
  const preview = approval.buildApprovalPreview(
    db.payrolls[0],
    3,
    'PLAN-APPROVAL',
    { email: 'director@proqpay.id', role: 'DIRECTOR' }
  );
  assert.equal(preview.currentStatus, 'CALCULATED');
  assert.equal(preview.validationErrors, 3);
  const first = approval.applyApproval(db, preview, 1234);
  assert.equal(first.alreadyApplied, false);
  assert.equal(first.db.payrolls[0].status, 'APPROVED');
  assert.equal(first.db.approvals.length, 1);
  assert.equal(first.db.auditLogs[0].user, 'director@proqpay.id');
  const second = approval.applyApproval(first.db, preview, 5678);
  assert.equal(second.alreadyApplied, true);
  assert.equal(second.db.approvals.length, 1);
});

test('IDA markdown renders payroll pipe data as a responsive table', async () => {
  const markdown = await loadTsModule('src/lib/markdown.ts');
  const html = markdown.renderMarkdown(
    '| Karyawan | Gross | Net |\n|---|---:|---:|\n| Ani | Rp 3.000.000 | Rp 2.900.000 |'
  );
  assert.match(html, /<table/);
  assert.match(html, /<th[^>]*>Karyawan<\/th>/);
  assert.match(html, /<td[^>]*>Ani<\/td>/);
  assert.doesNotMatch(html, /\|---\|/);
});

test('IDA markdown escapes raw HTML before rendering formatting', async () => {
  const markdown = await loadTsModule('src/lib/markdown.ts');
  const html = markdown.renderMarkdown('<img src=x onerror="alert(1)"> **aman**');
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img src=x onerror="alert\(1\)"&gt;/);
  assert.match(html, /<strong>aman<\/strong>/);
});

test('evidence worker finds duplicate employee names from records', async () => {
  const query = await loadTsModule('src/lib/ida-os/evidence-query.ts', {
    payrollValidation: { validatePayrollIndonesia: () => ({ issues: [], errorCount: 0, warningCount: 0 }) },
  });
  const result = query.answerEvidenceQuery('ada berapa karyawan yang punya nama sama?', {
    employees: [
      { id: 'EMP-1', name: 'Ani  Wijaya' },
      { id: 'EMP-2', name: 'ani wijaya' },
      { id: 'EMP-3', name: 'Budi' },
    ],
  });
  assert.equal(result.worker, 'HR');
  assert.match(result.markdown, /1 nama duplikat/);
  assert.match(result.markdown, /2 karyawan/);
  assert.deepEqual(result.recordIds, ['EMP-1', 'EMP-2']);
});

test('evidence worker counts expired contracts without subtracting active totals', async () => {
  const query = await loadTsModule('src/lib/ida-os/evidence-query.ts', {
    payrollValidation: { validatePayrollIndonesia: () => ({ issues: [], errorCount: 0, warningCount: 0 }) },
  });
  const db = {
    employees: [
      { id: 'EMP-1', name: 'Ani', contractEnd: '2025-01-31', status: 'KONTRAK' },
      { id: 'EMP-2', name: 'Budi', contractEnd: '2026-12-31', status: 'KONTRAK' },
      { id: 'EMP-3', name: 'Citra', status: 'KONTRAK' },
    ],
  };
  const count = query.answerEvidenceQuery('yang kontraknya sudah habis berapa?', db, { referenceDate: '2026-08-10' });
  assert.match(count.markdown, /1 karyawan/);
  assert.match(count.markdown, /belum cukup: \*\*1\*\*/);
  const oldest = query.answerEvidenceQuery('yang paling lama sudah habis siapa?', db, { referenceDate: '2026-08-10' });
  assert.match(oldest.markdown, /Ani/);
  assert.match(oldest.markdown, /EMP-1/);
});

test('evidence worker distinguishes projects from clients', async () => {
  const query = await loadTsModule('src/lib/ida-os/evidence-query.ts', {
    payrollValidation: { validatePayrollIndonesia: () => ({ issues: [], errorCount: 0, warningCount: 0 }) },
  });
  const result = query.answerEvidenceQuery('ada berapa project sekarang?', {
    employees: [],
    companies: [{ id: 'C-1' }],
    projects: [{ id: 'P-1', name: 'Payroll IAP' }, { id: 'P-2', name: 'BPJS IAP' }],
  });
  assert.match(result.markdown, /2 project/);
  assert.match(result.markdown, /1 klien/);
});

test('evidence worker reports payroll validation issues and affected employees', async () => {
  const query = await loadTsModule('src/lib/ida-os/evidence-query.ts', {
    payrollValidation: {
      validatePayrollIndonesia: () => ({
        errorCount: 2,
        warningCount: 1,
        issues: [
          { severity: 'error', code: 'BANK_MISSING', employeeId: 'EMP-1' },
          { severity: 'error', code: 'NIK_INVALID', employeeId: 'EMP-1' },
          { severity: 'warning', code: 'EMAIL_MISSING', employeeId: 'EMP-2' },
        ],
      }),
    },
  });
  const result = query.answerEvidenceQuery('ada berapa data bermasalah?', {
    meta: { currentPeriod: '2026-08' }, employees: [], payrolls: [],
  });
  assert.match(result.markdown, /Error data\/compliance: \*\*2\*\*/);
  assert.match(result.markdown, /Karyawan terdampak: \*\*1\*\*/);
});

test('HR read worker returns the deterministic database answer to the orchestrator', async () => {
  const registry = await loadTsModule('src/lib/ida-os/worker-registry.ts');
  const evidenceQuery = await loadTsModule('src/lib/ida-os/evidence-query.ts', {
    payrollValidation: { validatePayrollIndonesia: () => ({ issues: [], errorCount: 0, warningCount: 0 }) },
  });
  const readWorkers = await loadTsModule('src/lib/ida-os/read-workers.ts', {
    workerRegistry: registry,
    payrollValidation: { validatePayrollIndonesia: () => ({ issues: [], errorCount: 0, warningCount: 0 }) },
    evidenceQuery,
  });
  const result = readWorkers.executeReadOnlyPlan({
    risk: 'READ',
    objective: 'ada berapa karyawan yang punya nama sama?',
    tasks: [{ worker: 'HR', context: {} }],
  }, {
    employees: [{ id: 'EMP-1', name: 'Ani' }, { id: 'EMP-2', name: 'ANI' }],
  });
  assert.match(result.answerMarkdown, /1 nama duplikat/);
  assert.equal(result.worker, 'HR');
});
