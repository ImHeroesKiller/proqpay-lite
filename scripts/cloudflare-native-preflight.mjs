import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const checks = [];
const record = (name, ok, detail) => checks.push({ name, ok, detail });

const migration = read('migrations/0001_cloudflare_native.sql');
const db = new DatabaseSync(':memory:');
try {
  db.exec(migration);
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n;
  record('D1 migration', tables === 38, `${tables} canonical tables`);
} catch (error) {
  record('D1 migration', false, error.message);
}

const runtimeFiles = fs.readdirSync(new URL('functions/api/', root)).filter((name) => name.endsWith('.js'));
const runtime = runtimeFiles.map((name) => read(`functions/api/${name}`)).join('\n');
record('Neon removed', !/@neondatabase|DATABASE_URL|NEON_DATABASE_URL|POSTGRES_URL/.test(runtime), 'runtime scan');
record('Legacy payment tables absent', !/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:payments|approvals)\b/i.test(migration), 'schema scan');
record('Immutable PI trigger',
  /payment_instruction_lines_immutable_update/.test(migration)
    && /payment_instruction_lines_immutable_delete/.test(migration),
  'update/delete trigger');

const config = read('wrangler.example.jsonc');
for (const binding of ['"binding": "DB"', '"binding": "FILES"', '"binding": "AI"']) {
  record(`Binding ${binding.split('"')[3]}`, config.includes(binding), 'example config');
}

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
