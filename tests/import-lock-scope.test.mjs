import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('master importer contains no payroll creation or replacement branch', async () => {
  const source = await readFile(new URL('../functions/api/import-d1.js', import.meta.url),'utf8');
  assert.doesNotMatch(source, /payroll_submissions/);
  assert.doesNotMatch(source, /payroll_run_lines/);
  assert.doesNotMatch(source, /UPLOAD_FINAL/);
  assert.doesNotMatch(source, /PAY_RUN_INPUT_REPLACED/);
  assert.match(source, /EMPLOYEE_IMPORT/);
});
