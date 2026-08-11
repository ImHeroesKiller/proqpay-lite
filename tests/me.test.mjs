import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/me.js';
import { permissionsFor } from '../functions/api/_security.js';

test('origin mode exposes compatibility actor without claiming authentication', async () => {
  const request = new Request('https://proqpay-lite.pages.dev/api/me');
  const response = await onRequest({ request, env: {} });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.authenticated, false);
  assert.equal(body.user.role, 'SUPER_ADMIN');
  assert.ok(body.user.permissions.includes('schema:write'));
});

test('access mode fails closed without a valid Access assertion', async () => {
  const request = new Request('https://proqpay-lite.pages.dev/api/me');
  const response = await onRequest({
    request,
    env: {
      AUTH_MODE: 'access',
      CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
      CF_ACCESS_AUD: 'audience',
    },
  });

  assert.equal(response.status, 401);
});

test('permissions fail closed for an unknown role', () => {
  assert.deepEqual(permissionsFor('UNKNOWN'), []);
});
