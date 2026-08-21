import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/prepare-bootstrap-admin.mjs');
const migration = fs.readFileSync(path.join(root, 'migrations/0001_cloudflare_native.sql'), 'utf8');

test('bootstrap SQL creates exactly one active Super Admin without plaintext password', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proqpay-admin-bootstrap-'));
  const sqlPath = path.join(directory, 'bootstrap.sql');
  const password = 'Uat!BootstrapAdmin2026';
  execFileSync(process.execPath, [script, sqlPath], {
    env: {
      ...process.env,
      PROQPAY_BOOTSTRAP_ADMIN_EMAIL: 'admin@proqpay.test',
      PROQPAY_BOOTSTRAP_ADMIN_PASSWORD: password,
    },
  });

  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.doesNotMatch(sql, new RegExp(password));
  const database = new DatabaseSync(':memory:');
  database.exec(migration);
  database.exec(sql);
  database.exec(sql);
  const row = database.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role='SUPER_ADMIN' AND status='ACTIVE' AND email='admin@proqpay.test'").get();
  assert.equal(row.n, 1);
});

test('bootstrap SQL repairs an existing inactive account for the configured email', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proqpay-admin-bootstrap-'));
  const sqlPath = path.join(directory, 'bootstrap.sql');
  execFileSync(process.execPath, [script, sqlPath], {
    env: {
      ...process.env,
      PROQPAY_BOOTSTRAP_ADMIN_EMAIL: 'admin@proqpay.test',
      PROQPAY_BOOTSTRAP_ADMIN_PASSWORD: 'Uat!BootstrapAdmin2026',
    },
  });
  const database = new DatabaseSync(':memory:');
  database.exec(migration);
  database.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'USR-OLD', 'ORG-OTSINDO', 'Old User', 'admin@proqpay.test', 'PAYROLL_PROCESSOR',
      'INACTIVE', 'old', 'old', 100000, 0, 0, 'TEST',
    );
  database.exec(fs.readFileSync(sqlPath, 'utf8'));
  const row = database.prepare("SELECT role,status,must_change_password,payment_approver FROM app_users WHERE email='admin@proqpay.test'").get();
  assert.deepEqual({ ...row }, { role: 'SUPER_ADMIN', status: 'ACTIVE', must_change_password: 1, payment_approver: 1 });
});

test('bootstrap SQL rejects a weak password', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proqpay-admin-bootstrap-'));
  assert.throws(() => execFileSync(process.execPath, [script, path.join(directory, 'bootstrap.sql')], {
    env: {
      ...process.env,
      PROQPAY_BOOTSTRAP_ADMIN_EMAIL: 'admin@proqpay.test',
      PROQPAY_BOOTSTRAP_ADMIN_PASSWORD: 'weak',
    },
    stdio: 'pipe',
  }), /Command failed/);
});
