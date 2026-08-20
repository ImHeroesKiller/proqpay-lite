import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('paid payroll guard is scoped to employees in the imported file', async () => {
  const source = await readFile(
    new URL('../functions/api/import-d1.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /e\.id IN/);
  assert.match(source, /ec\.payroll_source_period=\?/);
  assert.match(source, /s\.state IN \('PAYMENT_INSTRUCTION_READY'/);
  assert.match(source, /LOCKED_PAYROLL_EMPLOYEE_CONFLICT/);
});
