import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadInsights(validationResult) {
  const source = await readFile(new URL('../src/lib/client-insights.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const require = (specifier) => {
    if (specifier === './payroll-validate') {
      return { validatePayrollIndonesia: () => validationResult };
    }
    throw new Error(`Unexpected import ${specifier}`);
  };
  new Function('exports', 'require', compiled)(exports, require);
  return exports;
}

test('client insight never claims complete when validation has blockers', async () => {
  const insightsModule = await loadInsights({ errorCount: 41, warningCount: 0 });
  const insights = insightsModule.buildClientInsights({
    meta: { currentPeriod: '2026-07' },
    employees: [{ company: 'Client A' }],
    companies: [{ name: 'Client A', payrollSetup: {} }],
    invoices: [],
    arMonitor: [],
  }, 'Client A');
  assert.match(insights[0].text, /41 error/);
  assert.equal(insights.some((item) => /tidak menemukan masalah/.test(item.text)), false);
});

test('client insight reports clean state only after deterministic validation', async () => {
  const insightsModule = await loadInsights({ errorCount: 0, warningCount: 0 });
  const insights = insightsModule.buildClientInsights({
    meta: { currentPeriod: '2026-07' },
    employees: [{ company: 'Client A' }],
    companies: [{ name: 'Client A', payrollSetup: {} }],
    invoices: [],
    arMonitor: [],
  }, 'Client A');
  assert.deepEqual(insights, [{ icon: '✨', text: 'Validasi data tidak menemukan masalah yang memblokir.' }]);
});
