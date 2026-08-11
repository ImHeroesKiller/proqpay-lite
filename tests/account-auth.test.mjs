import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_ROLES, generateTemporaryPassword, passwordRecord, validatePassword, verifyPassword,
} from '../functions/api/_account-auth.js';

test('account model exposes only the four approved roles', () => {
  assert.deepEqual([...ACCOUNT_ROLES], [
    'SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER',
  ]);
});

test('temporary password is strong and stored as PBKDF2 material', async () => {
  const password = generateTemporaryPassword();
  assert.equal(validatePassword(password), null);
  const record = await passwordRecord(password);
  assert.notEqual(record.hash, password);
  assert.ok(record.iterations >= 200_000);
  assert.equal(await verifyPassword(password, {
    password_hash: record.hash,
    password_salt: record.salt,
    password_iterations: record.iterations,
  }), true);
  assert.equal(await verifyPassword(`${password}x`, {
    password_hash: record.hash,
    password_salt: record.salt,
    password_iterations: record.iterations,
  }), false);
});

test('password policy rejects weak credentials', () => {
  assert.match(validatePassword('password') || '', /minimal 12/);
  assert.match(validatePassword('longpasswordonly') || '', /huruf besar/);
});
