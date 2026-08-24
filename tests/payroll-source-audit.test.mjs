import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePayrollControlRows } from '../functions/api/payroll-upload-validation.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('strict payroll controls require Gross - Deduction = Net', () => {
  const valid = validatePayrollControlRows([{ nrk:'E1', name:'A', grossPay:1000, totalDeductions:200, netPay:800, bank:'BCA', accountNo:'12345678' }]);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.totals, { gross:1000, deduction:200, net:800, employees:1 });

  const invalid = validatePayrollControlRows([{ nrk:'E1', name:'A', grossPay:1000, totalDeductions:200, netPay:900, bank:'BCA', accountNo:'12345678' }]);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some((issue) => issue.field === 'controlTotal'));
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
    assert.match(api, new RegExp(report.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(api, /pi\.status='COMPLETED'/);
  assert.match(api, /COALESCE\(r\.status,''\)='MATCHED'/);
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
