import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  gatewayIdempotencyKey,
  gatewayReadiness,
  gatewayRequestHash,
  hmacSha256Hex,
  normalizeGatewayStatus,
  verifyMockWebhookSignature,
} from '../functions/api/payment-gateway-core.js';

test('payment gateway is fail-closed until provider is configured', () => {
  assert.deepEqual(gatewayReadiness({}), {
    configured: false,
    provider: 'UNCONFIGURED',
    reason: 'Provider payment gateway belum dipilih.',
  });
  assert.equal(gatewayReadiness({ PAYMENT_GATEWAY_PROVIDER:'MOCK' }).configured, false);
  assert.equal(gatewayReadiness({ PAYMENT_GATEWAY_PROVIDER:'MOCK', PAYMENT_GATEWAY_ALLOW_MOCK:'true' }).configured, true);
  assert.equal(gatewayReadiness({ PAYMENT_GATEWAY_PROVIDER:'REAL_PROVIDER' }).configured, false);
});

test('provider statuses normalize to ProQPay gateway states', () => {
  assert.equal(normalizeGatewayStatus('paid'), 'SUCCEEDED');
  assert.equal(normalizeGatewayStatus('in_progress'), 'PROCESSING');
  assert.equal(normalizeGatewayStatus('rejected'), 'FAILED');
  assert.equal(normalizeGatewayStatus('timeout'), 'EXPIRED');
  assert.equal(normalizeGatewayStatus('unknown-provider-state'), 'PENDING');
});

test('gateway idempotency and request hash bind execution to immutable PI', async () => {
  const payment = { id:'PI-1', content_hash:'a'.repeat(64), expected_total:125000, currency:'IDR' };
  assert.equal(gatewayIdempotencyKey(payment), `PG-PI-1-${'a'.repeat(32)}`);
  const first = await gatewayRequestHash(payment, ['line-b','line-a'], 'bank_transfer');
  const reordered = await gatewayRequestHash(payment, ['line-a','line-b'], 'bank_transfer');
  const changedAmount = await gatewayRequestHash({ ...payment, expected_total:125001 }, ['line-a','line-b'], 'bank_transfer');
  assert.equal(first, reordered);
  assert.notEqual(first, changedAmount);
});

test('mock webhook uses HMAC SHA-256 and rejects a different signature', async () => {
  const env = { PAYMENT_GATEWAY_WEBHOOK_SECRET:'uat-secret-only' };
  const body = JSON.stringify({ eventId:'evt-1', transactionId:'tx-1', status:'paid', amount:1000, currency:'IDR' });
  const signature = await hmacSha256Hex(env.PAYMENT_GATEWAY_WEBHOOK_SECRET, body);
  assert.equal(await verifyMockWebhookSignature(env, body, `sha256=${signature}`), true);
  assert.equal(await verifyMockWebhookSignature(env, body, `sha256=${'0'.repeat(64)}`), false);
});

test('migration creates gateway ledger, webhook event idempotency and active-transaction guard', async () => {
  const sql = await readFile(new URL('../migrations/0020_payment_gateway_orchestration.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE payment_gateway_transactions/);
  assert.match(sql, /CREATE TABLE payment_gateway_events/);
  assert.match(sql, /UNIQUE \(provider, provider_event_id\)/);
  assert.match(sql, /idx_one_active_gateway_transaction/);
});

test('gateway endpoint requires approved hash and payment:prepare permission', async () => {
  const source = await readFile(new URL('../functions/api/payment-gateway.js', import.meta.url), 'utf8');
  assert.match(source, /approved_hash !== payment\.content_hash/);
  assert.match(source, /permissions\?\.includes\('payment:prepare'\)/);
  assert.match(source, /PAYMENT_GATEWAY_NOT_READY/);
  assert.match(source, /beneficiarySnapshot/);
});

test('webhook refuses mismatched amount or currency before completion', async () => {
  const source = await readFile(new URL('../functions/api/payment-gateway-webhook.js', import.meta.url), 'utf8');
  assert.match(source, /WEBHOOK_CONTROL_MISMATCH/);
  assert.match(source, /Invalid webhook signature/);
  assert.match(source, /status='COMPLETED'/);
  assert.match(source, /markEwaRepaid/);
});
