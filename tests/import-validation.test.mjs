import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMPORT_ROWS,
  validateImportRows,
} from '../functions/api/import-validation.js';

test('accepts and normalizes a valid import row', () => {
  const result = validateImportRows([
    {
      nrk: ' EMP-001 ',
      name: ' Ary ',
      basicSalary: '5000000',
      joinDate: '2026-07-01',
      email: 'ary@example.com',
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.rows[0].nrk, 'EMP-001');
  assert.equal(result.rows[0].name, 'Ary');
  assert.equal(result.rows[0].basicSalary, 5_000_000);
});

test('rejects duplicate NRK before database writes', () => {
  const result = validateImportRows([
    { nrk: 'EMP-001', name: 'Ary', basicSalary: 1 },
    { nrk: 'emp-001', name: 'Ary 2', basicSalary: 1 },
  ]);

  assert.equal(result.ok, false);
  assert.match(result.issues[0].message, /duplikat/i);
});

test('rejects invalid dates, salaries, and emails', () => {
  const result = validateImportRows([
    {
      nrk: 'EMP-002',
      name: 'Test',
      basicSalary: -1,
      joinDate: '2026-02-31',
      email: 'invalid',
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 3);
});

test('rejects oversized batches', () => {
  const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => ({
    nrk: `EMP-${index}`,
    name: `Employee ${index}`,
    basicSalary: 1,
  }));
  const result = validateImportRows(rows);

  assert.equal(result.ok, false);
  assert.match(result.issues[0].message, /Maksimal/);
});
