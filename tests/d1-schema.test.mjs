import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const migration = fs.readFileSync(
  new URL('../migrations/0001_cloudflare_native.sql', import.meta.url),
  'utf8'
);

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  return db;
}

test('D1 schema is valid and excludes legacy payment tables', () => {
  const db = database();
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map((row) => row.name);
  assert.equal(names.length, 38);
  assert.ok(names.includes('payment_instructions'));
  assert.ok(names.includes('payment_instruction_lines'));
  assert.ok(!names.includes('payments'));
  assert.ok(!names.includes('approvals'));
});

test('D1 rejects mutation of immutable payment instruction lines', () => {
  const db = database();
  db.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('C','ORG-OTSINDO','C','Client');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('P','ORG-OTSINDO','C','P','Project','U');
    INSERT INTO client_service_plans(id,client_id,tier,effective_from,created_by)
      VALUES('S','C','T1','2026-08-01','U');
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,created_by)
      VALUES('SUB','ORG-OTSINDO','C','P','S','T1','2026-08','U');
    INSERT INTO payment_instructions(id,org_id,client_id,submission_id,expected_total,creator_user_id,idempotency_key)
      VALUES('PI','ORG-OTSINDO','C','SUB',100,'U','KEY');
    INSERT INTO payment_instruction_lines(
      id,payment_instruction_id,beneficiary_name,bank_name,masked_account,
      account_ciphertext,account_iv,account_last4,line_hash,amount
    ) VALUES('LINE','PI','Ary','BCA','****1234','cipher','iv','1234','hash',100);
  `);
  assert.throws(
    () => db.exec("UPDATE payment_instruction_lines SET amount=200 WHERE id='LINE'"),
    /immutable/
  );
  assert.throws(
    () => db.exec("DELETE FROM payment_instruction_lines WHERE id='LINE'"),
    /immutable/
  );
});

test('phase 3B APIs do not depend on Neon or runtime DDL', () => {
  const files = [
    '../functions/api/billing.js',
    '../functions/api/state.js',
    '../functions/api/import-d1.js',
    '../functions/api/ida-rag.js',
    '../functions/api/ida.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /@neondatabase|DATABASE_URL|GEMINI_WORKER/);
    assert.doesNotMatch(source, /\bCREATE\s+TABLE\b/i);
  }
});

test('production runtime is Cloudflare-native and excludes Neon configuration', () => {
  const runtime = fs.readdirSync(new URL('../functions/api/', import.meta.url))
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(new URL(`../functions/api/${name}`, import.meta.url), 'utf8'))
    .join('\n');
  const packageJson = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  assert.doesNotMatch(runtime, /@neondatabase\/serverless|DATABASE_URL|NEON_DATABASE_URL|POSTGRES_URL/);
  assert.doesNotMatch(packageJson, /@neondatabase\/serverless/);
  assert.match(runtime, /D1_REQUIRED/);
  assert.match(runtime, /IMMUTABLE_PAYMENT_HISTORY/);
});

test('runtime and deployment examples exclude Gemini configuration', () => {
  const files = [
    '../functions/api/ida.js',
    '../.env.example',
    '../wrangler.example.jsonc',
    '../scripts/prepare-pages-config.mjs',
  ];
  const source = files
    .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /GEMINI_API_KEY|GEMINI_MODEL|generativelanguage\.googleapis/i);
  assert.match(source, /WORKERS_AI_FALLBACK_MODEL/);
});

test('local Wrangler configuration does not contain plaintext credentials', () => {
  const path = new URL('../wrangler.toml', import.meta.url);
  if (!fs.existsSync(path)) return;
  const source = fs.readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i);
  assert.doesNotMatch(source, /(?:GEMINI|OPENAI|TAVILY|API)_?(?:KEY|TOKEN|WORKER)\s*=/i);
});
