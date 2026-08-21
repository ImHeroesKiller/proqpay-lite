import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseId = 'ac3f8b48-bd87-44bd-9286-f0e0bab6e39f';

test('prepare Pages config accepts Wrangler v4 TOML download', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proqpay-pages-config-'));
  fs.copyFileSync(path.join(root, 'scripts/prepare-pages-config.mjs'), path.join(directory, 'prepare-pages-config.mjs'));
  fs.copyFileSync(path.join(root, 'wrangler.example.jsonc'), path.join(directory, 'wrangler.example.jsonc'));
  fs.writeFileSync(path.join(directory, 'wrangler.toml'), [
    'name = "proqpay-lite"',
    'pages_build_output_dir = "./out"',
    'compatibility_date = "2026-08-21"',
    '',
  ].join('\n'));

  execFileSync(process.execPath, ['prepare-pages-config.mjs', databaseId], { cwd: directory });
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'wrangler.jsonc'), 'utf8'));

  assert.equal(config.name, 'proqpay-lite');
  assert.equal(config.d1_databases[0].database_id, databaseId);
  assert.equal(config.d1_databases[0].binding, 'DB');
  assert.equal(config.r2_buckets[0].binding, 'FILES');
  assert.equal(config.ai.binding, 'AI');
  assert.equal(config.vars.DATA_BACKEND, 'd1');
  assert.equal(config.vars.AUTH_MODE, 'session');
  assert.equal(config.kv_namespaces, undefined);
});

test('prepare Pages config rejects a TOML download for another project', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proqpay-pages-config-'));
  fs.copyFileSync(path.join(root, 'scripts/prepare-pages-config.mjs'), path.join(directory, 'prepare-pages-config.mjs'));
  fs.copyFileSync(path.join(root, 'wrangler.example.jsonc'), path.join(directory, 'wrangler.example.jsonc'));
  fs.writeFileSync(path.join(directory, 'wrangler.toml'), 'name = "wrong-project"\n');

  assert.throws(
    () => execFileSync(process.execPath, ['prepare-pages-config.mjs', databaseId], { cwd: directory, stdio: 'pipe' }),
    /Command failed/,
  );
  assert.equal(fs.existsSync(path.join(directory, 'wrangler.jsonc')), false);
});
