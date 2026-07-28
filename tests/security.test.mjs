import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorize,
  corsHeaders,
  handlePreflight,
} from '../functions/api/_security.js';
import { validateEmailFillRequest } from '../functions/api/employee-email-fill-validation.js';

const url = 'https://proqpay-lite.pages.dev/api/import';

test('CORS reflects only an allowed origin', () => {
  const request = new Request(url, {
    headers: { Origin: 'https://app.example.com' },
  });
  const headers = corsHeaders(request, {
    APP_ORIGINS: 'https://app.example.com',
  });
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://app.example.com');
  assert.notEqual(headers['Access-Control-Allow-Origin'], '*');
});

test('preflight rejects an unknown origin', () => {
  const request = new Request(url, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  });
  const response = handlePreflight(request, {}, 'POST, OPTIONS');
  assert.equal(response.status, 403);
});

test('origin mode rejects cross-site mutations', async () => {
  const request = new Request(url, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site',
    },
  });
  const result = await authorize(request, {}, {
    mutating: true,
    roles: ['SUPER_ADMIN'],
    methods: 'POST, OPTIONS',
  });
  assert.equal(result.response.status, 403);
});

test('origin mode allows same-origin mutations', async () => {
  const request = new Request(url, {
    method: 'POST',
    headers: {
      Origin: 'https://proqpay-lite.pages.dev',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  const result = await authorize(request, {}, {
    mutating: true,
    roles: ['SUPER_ADMIN'],
    methods: 'POST, OPTIONS',
  });
  assert.equal(result.actor.role, 'SUPER_ADMIN');
});

test('access mode fails closed when Access is not configured', async () => {
  const request = new Request(url);
  const result = await authorize(request, { AUTH_MODE: 'access' }, {
    roles: ['SUPER_ADMIN'],
  });
  assert.equal(result.response.status, 401);
});

test('email placeholder mutation requires exact confirmation and safe invalid domain', () => {
  const valid = validateEmailFillRequest({
    confirmation: 'ISI EMAIL DUMMY',
    planId: 'PLAN-EMAIL-ABC123',
    domain: 'indomarco.pending.proqpay.invalid',
    expectedCount: 11,
  });
  assert.equal(valid.ok, true);

  const unsafe = validateEmailFillRequest({
    confirmation: 'iya',
    planId: 'bad',
    domain: 'indomarco.com',
    expectedCount: 11,
  });
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.errors.join(' '), /Konfirmasi wajib/);
  assert.match(unsafe.errors.join(' '), /\.invalid/);
});
