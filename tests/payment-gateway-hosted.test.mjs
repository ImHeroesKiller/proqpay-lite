import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedReturnPath,
  generateHostedState,
  hostedReadiness,
  hostedSessionTtlSeconds,
  hostedStateHash,
  normalizeReturnPath,
  validateHostedReturn,
} from '../functions/api/payment-gateway-hosted-core.js';

test('hosted payment remains fail-closed unless gateway and hosted mode are enabled', () => {
  assert.equal(hostedReadiness({ PAYMENT_GATEWAY_PROVIDER:'UNCONFIGURED' }).configured, false);
  assert.equal(hostedReadiness({ PAYMENT_GATEWAY_PROVIDER:'MOCK', PAYMENT_GATEWAY_ALLOW_MOCK:'true' }).configured, false);
  assert.equal(hostedReadiness({
    PAYMENT_GATEWAY_PROVIDER:'MOCK',
    PAYMENT_GATEWAY_ALLOW_MOCK:'true',
    PAYMENT_GATEWAY_HOSTED_ENABLED:'true',
  }).configured, true);
});

test('hosted TTL is clamped to 5-60 minutes', () => {
  assert.equal(hostedSessionTtlSeconds({ PAYMENT_GATEWAY_HOSTED_TTL_SECONDS:'10' }), 300);
  assert.equal(hostedSessionTtlSeconds({ PAYMENT_GATEWAY_HOSTED_TTL_SECONDS:'900' }), 900);
  assert.equal(hostedSessionTtlSeconds({ PAYMENT_GATEWAY_HOSTED_TTL_SECONDS:'99999' }), 3600);
});

test('hosted return path rejects external and protocol-relative redirects', () => {
  assert.equal(normalizeReturnPath('/?view=payments'), '/?view=payments');
  assert.throws(() => normalizeReturnPath('https://evil.example/pay'), /relative path/);
  assert.throws(() => normalizeReturnPath('//evil.example/pay'), /relative path/);
});

test('hosted return allowlist restricts browser destination', () => {
  const env = { PAYMENT_GATEWAY_HOSTED_RETURN_PREFIXES:'/payments,/operations' };
  assert.equal(allowedReturnPath(env, '/payments?status=processing'), '/payments?status=processing');
  assert.equal(allowedReturnPath(env, '/operations/run/123'), '/operations/run/123');
  assert.throws(() => allowedReturnPath(env, '/admin'), /allowlist/);
});

test('hosted state stores hash and validates without persisting raw nonce', async () => {
  const state = generateHostedState();
  assert.ok(state.length >= 32);
  const hash = await hostedStateHash(state);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, state);
  assert.equal(await validateHostedReturn({ state, expectedStateHash:hash }), true);
  assert.equal(await validateHostedReturn({ state:`${state}x`, expectedStateHash:hash }), false);
});
