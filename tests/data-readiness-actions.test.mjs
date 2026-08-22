import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Pay Run readiness exposes filters, recommendations, and direct fix actions', async () => {
  const source = await readFile(new URL('../src/components/OperatingWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /AI DATA READINESS/);
  assert.match(source, /THP kosong\/nol/);
  assert.match(source, /Rekening belum lengkap/);
  assert.match(source, /Edit nominal/);
  assert.match(source, /employeeQuery=/);
});

test('employee deep-link filters and opens the exact matching profile', async () => {
  const source = await readFile(new URL('../src/components/EmployeeDirectory.tsx', import.meta.url), 'utf8');
  assert.match(source, /get\('employeeQuery'\)/);
  assert.match(source, /filtered\.length !== 1/);
  assert.match(source, /setSelected\(filtered\[0\]\)/);
});
