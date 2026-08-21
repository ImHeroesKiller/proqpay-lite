import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/health.js';
import { D1Mock } from './helpers/d1-mock.mjs';

test('production health reports session auth without downgrading it to origin', async () => {
  const response = await onRequest({
    request: new Request('https://proqpay-lite.pages.dev/api/health'),
    env: {
      AUTH_MODE: 'session',
      DB: new D1Mock(),
      FILES: { put() {}, get() {} },
      AI: { run() {} },
      PI_ENCRYPTION_KEY: 'x'.repeat(32),
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ready, true);
  assert.equal(body.database, 'd1');
  assert.equal(body.auth_mode, 'session');
});
