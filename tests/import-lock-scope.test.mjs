import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('paid payroll guard is scoped to employees in the imported file', async () => {
  const source = await readFile(
    new URL('../functions/api/import.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /jsonb_array_elements/);
  assert.match(source, /detail->>'employeeId'/);
  assert.match(source, /= ANY\(\$\{importEmployeeIds\}::text\[\]\)/);
  assert.match(source, /LOCKED_PAYROLL_EMPLOYEE_CONFLICT/);
});
