import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyPassword } from '../functions/api/_account-auth.js';
import { hashPortalPassword } from '../scripts/seed-employee-portal-passwords.mjs';

test('seed hasher matches portal verifyPassword', async () => {
  const password = 'NOCP120200920';
  const record = hashPortalPassword(password);
  const ok = await verifyPassword(password, {
    password_hash: record.hash,
    password_salt: record.salt,
    password_iterations: record.iterations,
  });
  assert.equal(ok, true);
  const bad = await verifyPassword('wrong-password-xx', {
    password_hash: record.hash,
    password_salt: record.salt,
    password_iterations: record.iterations,
  });
  assert.equal(bad, false);
});
