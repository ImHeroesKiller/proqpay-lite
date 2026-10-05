import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const script = fs.readFileSync(new URL('../scripts/migrate-neon-uat.mjs', import.meta.url), 'utf8');
test('retired Neon UAT migration has no active GitHub Action and keeps the converter read-only', () => {
  const retiredWorkflow = new URL('../.github/workflows/neon-uat-migration.yml', import.meta.url);
  assert.equal(fs.existsSync(retiredWorkflow), false);
  assert.doesNotMatch(script, /['"](?:payments|approvals|payrolls)['"]/);
  assert.match(script, /BEGIN READ ONLY/);
  assert.doesNotMatch(script, /['"]BEGIN TRANSACTION;|['"]COMMIT;/);
  assert.match(script, /primarySeen/);
});

test('Neon UAT fixture transforms into valid canonical D1 SQL', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proqpay-neon-uat-'));
  const fixturePath = path.join(directory, 'source.json');
  const sqlPath = path.join(directory, 'import.sql');
  fs.writeFileSync(fixturePath, JSON.stringify({
    clients: [{ id: 'CLI-UAT', code: 'UAT', name: 'Client UAT' }],
    employees: [{ id: 'EMP-UAT', client_id: 'CLI-UAT', name: 'Pegawai UAT', status_aktif: 'ACTIVE' }],
    employee_compensation: [{ employee_id: 'EMP-UAT', basic_salary: 5000000 }],
    employee_bank_accounts: [{ id: 'BNK-UAT', employee_id: 'EMP-UAT', bank_name: 'BCA', account_no: '1234567890', is_primary: true }],
  }));
  execFileSync(process.execPath, ['scripts/migrate-neon-uat.mjs', sqlPath], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PROQPAY_NEON_DATABASE_URL: '', PROQPAY_NEON_SNAPSHOT_FILE: fixturePath },
  });

  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../migrations/0001_cloudflare_native.sql', import.meta.url), 'utf8'));
  db.exec(fs.readFileSync(sqlPath, 'utf8'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM employees WHERE id='EMP-UAT'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM employee_bank_accounts WHERE employee_id='EMP-UAT' AND is_primary=1").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='NEON_UAT_MIGRATION'").get().n, 1);
});
