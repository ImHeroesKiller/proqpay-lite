import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignDefaultPasswords, isActiveEmployee } from '../functions/api/_employee-auth.js';

const ORG_ID = process.env.DEFAULT_ORG_ID || 'ORG-OTSINDO';
const DATABASE = 'proqpay-lite-production';
const ITERATIONS = 100_000;
const INSERT_BATCH = 25;

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function hashPortalPassword(password) {
  const salt = b64url(crypto.randomBytes(18));
  const hash = b64url(crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256'));
  return { hash, salt, iterations: ITERATIONS };
}

function sqlString(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function d1Command(command) {
  const output = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--json', '--command', command],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const start = output.indexOf('[');
  if (start < 0) throw new Error('wrangler D1 tidak mengembalikan JSON');
  return JSON.parse(output.slice(start));
}

function d1File(sql) {
  const filePath = path.join(os.tmpdir(), `proqpay-seed-${crypto.randomUUID()}.sql`);
  fs.writeFileSync(filePath, sql);
  try {
    const output = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--json', '--file', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const start = output.indexOf('[');
    if (start < 0) return [];
    return JSON.parse(output.slice(start));
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

function results(payload) {
  return (Array.isArray(payload) ? payload : []).flatMap((entry) => entry.results || []);
}

export function seedEmployeePortalPasswords() {
  const pending = results(d1Command(`
    SELECT e.id, e.employee_code, e.name, e.status_aktif, e.created_at,
           p.code AS project_code, p.name AS project_name,
           c.join_date, c.accepted_date
    FROM employees e
    LEFT JOIN projects p ON p.id=e.project_id
    LEFT JOIN employee_contracts c ON c.employee_id=e.id AND c.is_current=1
    LEFT JOIN employee_credentials cred ON cred.employee_id=e.id
    WHERE e.org_id=${sqlString(ORG_ID)} AND cred.employee_id IS NULL
    ORDER BY e.id
  `));

  const eligible = pending.filter(isActiveEmployee);
  const assigned = assignDefaultPasswords(eligible);
  let issued = 0;

  for (let index = 0; index < assigned.length; index += INSERT_BATCH) {
    const chunk = assigned.slice(index, index + INSERT_BATCH);
    const statements = chunk.map((row) => {
      const record = hashPortalPassword(row.password);
      return `INSERT INTO employee_credentials
        (employee_id, password_hash, password_salt, password_iterations, must_change_password,
         failed_login_attempts, locked_until, default_password_scheme, default_password_issued_at, updated_at)
      VALUES (
        ${sqlString(row.id)}, ${sqlString(record.hash)}, ${sqlString(record.salt)}, ${record.iterations}, 1,
        0, NULL, ${sqlString(row.scheme)}, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
      )
      ON CONFLICT(employee_id) DO NOTHING;`;
    });
    d1File(statements.join('\n'));
    issued += chunk.length;
    console.log(JSON.stringify({ progress: issued, of: assigned.length }));
  }

  if (issued) {
    d1Command(`
      INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity)
      VALUES (
        ${sqlString(`AUD-${crypto.randomUUID()}`)}, ${sqlString(ORG_ID)}, 'github-actions', 'SUPER_ADMIN',
        'EMPLOYEE_PORTAL_PASSWORDS_ISSUED', ${sqlString(`${issued} password portal di-seed (plaintext tidak dicatat)`)},
        'employee_credentials'
      )
    `);
  }

  const summary = results(d1Command(`
    SELECT
      (SELECT COUNT(*) FROM employees WHERE org_id=${sqlString(ORG_ID)}) AS total,
      (SELECT COUNT(*) FROM employee_credentials c JOIN employees e ON e.id=c.employee_id WHERE e.org_id=${sqlString(ORG_ID)}) AS issued,
      (SELECT COUNT(*) FROM employees e LEFT JOIN employee_credentials c ON c.employee_id=e.id
        WHERE e.org_id=${sqlString(ORG_ID)} AND c.employee_id IS NULL) AS pending
  `))[0] || {};

  return {
    ok: true,
    seeded: issued,
    skippedInactive: pending.length - eligible.length,
    total: Number(summary.total || 0),
    issued: Number(summary.issued || 0),
    pending: Number(summary.pending || 0),
  };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(seedEmployeePortalPasswords()));
}
