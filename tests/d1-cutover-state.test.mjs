import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/validate-d1-cutover-state.mjs');

function validate(tableNames) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proqpay-d1-state-'));
  const input = path.join(directory, 'inventory.json');
  fs.writeFileSync(input, JSON.stringify([{ results: tableNames.map((name) => ({ name })) }]));
  return execFileSync(process.execPath, [script, input], { encoding: 'utf8' });
}

test('empty D1 is accepted for first cutover', () => {
  assert.match(validate([]), /D1_CUTOVER_STATE=empty/);
});

test('previously migrated canonical D1 is accepted for a safe resume', () => {
  const canonical = [
    'd1_migrations', 'organizations', 'clients', 'employees', 'employee_bank_accounts',
    'payroll_submissions', 'payment_instructions', 'payment_instruction_lines',
    'payment_approvals', 'payment_proofs', 'reconciliations', 'app_users', 'app_sessions',
  ];
  assert.match(validate(canonical), /D1_CUTOVER_STATE=resumable/);
});

test('partial or legacy schema is rejected', () => {
  assert.throws(() => validate(['organizations', 'clients']), /Command failed/);
  assert.throws(() => validate(['payments']), /Command failed/);
  assert.throws(() => validate(['organizations', 'clients', 'foreign_table']), /Command failed/);
});
