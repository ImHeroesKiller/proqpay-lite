import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadValidation() {
  const source = await readFile(new URL('../src/lib/payroll-validate.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, () => ({ UMR_2025: { 'DKI Jakarta': 5_396_761 } }));
  return exports;
}

async function loadDatabaseEngine() {
  const source = await readFile(new URL('../src/lib/database.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, () => ({}));
  return exports;
}

const employee = {
  id: 'EMP-1', clientId: 'CLI-1', name: 'ARY', region: 'DKI Jakarta',
  salaryGross: 3_000_000, accountNo: '1234567890', status: 'ACTIVE',
  bpjsKesehatan: false, bpjsKetenagakerjaan: false, pph21: true,
};

test('Tier 1 validates payment essentials without requiring HR master and statutory fields', async () => {
  const { validatePayrollIndonesia } = await loadValidation();
  const report = validatePayrollIndonesia({ employees: [employee], companies: [{ id: 'CLI-1' }], meta: { currentPeriod: '2026-08' } }, {
    tier: 'TIER_1_PAYMENT_PROCESSING', clientId: 'CLI-1', period: '2026-08',
  });
  assert.equal(report.errorCount, 0);
  assert.equal(report.issues.some((issue) => issue.code === 'NIK_INVALID'), false);
  assert.equal(report.issues.some((issue) => issue.code === 'BELOW_UMR'), false);
});

test('Tier 2 keeps HR and statutory validation active', async () => {
  const { validatePayrollIndonesia } = await loadValidation();
  const report = validatePayrollIndonesia({ employees: [employee], companies: [{ id: 'CLI-1' }], meta: { currentPeriod: '2026-08' } }, {
    tier: 'TIER_2_MANAGED_PAYROLL', clientId: 'CLI-1', period: '2026-08',
  });
  assert.equal(report.issues.some((issue) => issue.code === 'NIK_INVALID'), true);
  assert.equal(report.issues.some((issue) => issue.code === 'BELOW_UMR'), true);
});

test('payroll calculation preserves imported THP totals for the matching period', async () => {
  const { generatePayroll } = await loadDatabaseEngine();
  const payroll = generatePayroll({ employees: [{
    id: 'EMP-1', name: 'ARY', company: 'QJOB', salaryGross: 3_000_000,
    payrollSourcePeriod: '2026-08', importedGross: 4_500_000,
    importedDeduction: 500_000, importedNet: 4_000_000,
  }], companies: [], payrollRules: [] }, '2026-08');
  assert.equal(payroll.summary.totalGross, 4_500_000);
  assert.equal(payroll.summary.totalDeduction, 500_000);
  assert.equal(payroll.summary.totalNet, 4_000_000);
  assert.equal(payroll.details[0].source, 'IMPORTED_THP');
});
