import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('read APIs never run schema migrations on the request path', async () => {
  const files = await Promise.all([
    read('functions/api/operating-model.js'),
    read('functions/api/employees.js'),
    read('functions/api/client-projects.js'),
  ]);
  for (const source of files) {
    assert.doesNotMatch(source, /ALTER TABLE/i);
  }
});

test('session authentication touches and returns the session in one D1 batch', async () => {
  const source = await read('functions/api/_account-auth.js');
  const authenticate = source.slice(source.indexOf('export async function authenticateSession'), source.indexOf('export async function hasActiveAccounts'));
  assert.match(authenticate, /d1Batch/);
  assert.match(authenticate, /UPDATE app_sessions/);
  assert.equal((authenticate.match(/await d1Batch/g) || []).length, 1);
});

test('dashboard and header share the aggregated operating endpoint', async () => {
  const [dashboard, header] = await Promise.all([
    read('src/components/PayrollControlTower.tsx'),
    read('src/components/AppHeader.tsx'),
  ]);
  assert.match(dashboard, /listOperatingDashboard/);
  assert.match(header, /listOperatingDashboard/);
  assert.doesNotMatch(dashboard, /resources\.map/);
});

test('phase 2 auth and master APIs are D1-only', async () => {
  const files = await Promise.all([
    read('functions/api/_account-auth.js'),
    read('functions/api/login.js'),
    read('functions/api/logout.js'),
    read('functions/api/accounts.js'),
    read('functions/api/client-projects.js'),
    read('functions/api/employees.js'),
  ]);
  for (const source of files) {
    assert.doesNotMatch(source, /@neondatabase|DATABASE_URL|NEON_DATABASE_URL|POSTGRES_URL/);
    assert.doesNotMatch(source, /LATERAL|::jsonb|string_to_array|\bANY\s*\(/i);
  }
});

test('phase 3 canonical payment path uses D1 and R2 only', async () => {
  const files = await Promise.all([
    read('functions/api/operating-model-d1.js'),
    read('functions/api/payment-proof.js'),
    read('functions/api/payment-instruction-export.js'),
  ]);
  for (const source of files) {
    assert.doesNotMatch(source, /@neondatabase|DATABASE_URL|NEON_DATABASE_URL|POSTGRES_URL/);
    assert.doesNotMatch(source, /LATERAL|::jsonb|string_to_array|\bANY\s*\(/i);
  }
});
