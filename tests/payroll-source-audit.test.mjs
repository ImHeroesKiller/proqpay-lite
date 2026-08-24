import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePayrollControlRows } from '../functions/api/payroll-upload-validation.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('strict payroll controls require row and component balances', () => {
  const valid = validatePayrollControlRows([{
    nrk:'E1', name:'A', grossPay:1000, totalDeductions:200, netPay:800, bank:'BCA', accountNo:'12345678',
    payrollComponents:{ basicSalary:900, overtime:100, jhtDeduction:100, taxDeduction:100 },
  }]);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.totals, { gross:1000, deduction:200, net:800, employees:1 });

  const invalidNet = validatePayrollControlRows([{ nrk:'E1', name:'A', grossPay:1000, totalDeductions:200, netPay:900, bank:'BCA', accountNo:'12345678' }]);
  assert.equal(invalidNet.ok, false);
  assert.ok(invalidNet.issues.some((issue) => issue.field === 'controlTotal'));

  const invalidComponents = validatePayrollControlRows([{
    nrk:'E1', name:'A', grossPay:1000, totalDeductions:200, netPay:800, bank:'BCA', accountNo:'12345678',
    payrollComponents:{ basicSalary:900, taxDeduction:100 },
  }]);
  assert.equal(invalidComponents.ok, false);
  assert.ok(invalidComponents.issues.some((issue) => issue.field === 'earningComponents'));
  assert.ok(invalidComponents.issues.some((issue) => issue.field === 'deductionComponents'));
});

test('final payroll upload preserves source and never calls master importer', () => {
  const source = read('functions/api/payroll-upload.js');
  assert.match(source, /payroll_upload_batches/);
  assert.match(source, /fileHash/);
  assert.match(source, /PAYROLL_MASTER_MISMATCH/);
  assert.match(source, /INSERT INTO payroll_run_lines/);
  assert.doesNotMatch(source, /importRowsD1/);
  assert.doesNotMatch(source, /INSERT INTO employees/);
  assert.doesNotMatch(source, /employee_compensation.*UPDATE/i);
});

test('legacy JSON endpoint cannot bypass UPLOAD_FINAL provenance', () => {
  const source = read('functions/api/import.js');
  assert.match(source, /PAYROLL_PROVENANCE_REQUIRED/);
  assert.match(source, /if \(body\?\.context\)/);
});

test('D1 migrations lock source rows and final payroll snapshots', () => {
  const provenance = read('migrations/0014_payroll_source_provenance.sql');
  const immutable = read('migrations/0015_payroll_snapshot_immutability.sql');
  assert.match(provenance, /payroll_upload_batches/);
  assert.match(provenance, /file_sha256/);
  assert.match(provenance, /source_batch_id/);
  assert.match(immutable, /FINAL_PAYROLL_SNAPSHOT_IMMUTABLE/);
  assert.match(immutable, /PAYROLL_SOURCE_ROW_IMMUTABLE/);
});

test('reporting exposes register control upload audit and final payslip datasets', () => {
  const api = read('functions/api/payroll-reports.js');
  for (const report of ["type === 'register'", "type === 'control'", "type === 'uploads'", "type === 'payslips'", "type === 'exceptions'"]) {
    assert.ok(api.includes(report), `missing ${report}`);
  }
  assert.match(api, /pi\.status='COMPLETED'/);
  assert.match(api, /COALESCE\(r\.status,''\)='MATCHED'/);
});

test('raw source can be retrieved only through secure scoped endpoint', () => {
  const source = read('functions/api/payroll-source-file.js');
  assert.match(source, /authorize/);
  assert.match(source, /clientIdsFor/);
  assert.match(source, /X-ProQPay-File-SHA256/);
  assert.match(source, /private, no-store/);
});

test('canonical final payslips are keyed by submission and require matched reconciliation', () => {
  const source = read('functions/api/employee/payslips.js');
  assert.match(source, /submissionId/);
  assert.match(source, /runType/);
  assert.match(source, /pi\.status='COMPLETED'/);
  assert.match(source, /r\.status='MATCHED'/);
  assert.doesNotMatch(source, /seen\.has\(.*period/);
});

test('canonical Excel template contains required control sheets and columns', () => {
  const source = read('src/lib/payroll-template.ts');
  assert.match(source, /01_PAYROLL_DATA/);
  assert.match(source, /02_EMPLOYEE_REFERENCE/);
  assert.match(source, /03_CONTROL_TOTAL/);
  assert.match(source, /Gross/);
  assert.match(source, /Deduct/);
  assert.match(source, /Netto/);
  assert.match(source, /Balance Check/);
});
