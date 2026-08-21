import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const inputPath = String(process.argv[2] || '').trim();
if (!inputPath) throw new Error('Path inventory D1 wajib diisi');

const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const rows = (Array.isArray(payload) ? payload : [payload])
  .flatMap((result) => Array.isArray(result?.results) ? result.results : []);
const tables = new Set(rows.map((row) => String(row?.name || '').trim()).filter(Boolean));

const ignored = new Set(['d1_migrations', 'sqlite_sequence']);
const applicationTables = [...tables].filter((name) => !ignored.has(name));
const legacyTables = ['payments', 'approvals', 'payrolls'].filter((name) => tables.has(name));
if (legacyTables.length) {
  throw new Error(`Tabel payment legacy terdeteksi: ${legacyTables.join(', ')}`);
}

if (applicationTables.length === 0) {
  console.log('D1_CUTOVER_STATE=empty');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(path.join(root, 'migrations/0001_cloudflare_native.sql'), 'utf8');
const canonicalTables = new Set([...migration.matchAll(/CREATE\s+TABLE\s+([A-Za-z0-9_]+)/gi)].map((match) => match[1]));
const unexpected = applicationTables.filter((name) => !canonicalTables.has(name));
if (unexpected.length) {
  throw new Error(`Tabel non-canonical terdeteksi: ${unexpected.join(', ')}`);
}

const requiredCanonicalTables = [
  'organizations',
  'clients',
  'employees',
  'employee_bank_accounts',
  'payroll_submissions',
  'payment_instructions',
  'payment_instruction_lines',
  'payment_approvals',
  'payment_proofs',
  'reconciliations',
  'app_users',
  'app_sessions',
];
const missing = requiredCanonicalTables.filter((name) => !tables.has(name));
if (missing.length) {
  throw new Error(`D1 terisi tetapi schema canonical tidak lengkap: ${missing.join(', ')}`);
}

console.log('D1_CUTOVER_STATE=resumable');
