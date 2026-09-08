import { sha256Hex } from './payment-instruction-core.js';

const ACTIVE_STATUSES = new Set(['CREATED', 'PENDING', 'PROCESSING']);
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED']);
const encoder = new TextEncoder();

export class PaymentGatewayConfigurationError extends Error {
  constructor(message = 'Payment gateway adapter belum dikonfigurasi') {
    super(message);
    this.name = 'PaymentGatewayConfigurationError';
  }
}

export function normalizeGatewayStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (['SUCCESS', 'SUCCEEDED', 'PAID', 'COMPLETED', 'SETTLED'].includes(status)) return 'SUCCEEDED';
  if (['PROCESSING', 'IN_PROGRESS', 'IN-PROGRESS'].includes(status)) return 'PROCESSING';
  if (['PENDING', 'CREATED', 'INITIATED', 'WAITING'].includes(status)) return status === 'CREATED' ? 'CREATED' : 'PENDING';
  if (['EXPIRED', 'TIMEOUT'].includes(status)) return 'EXPIRED';
  if (['CANCELLED', 'CANCELED', 'VOIDED'].includes(status)) return 'CANCELLED';
  if (['FAILED', 'FAIL', 'REJECTED', 'ERROR'].includes(status)) return 'FAILED';
  return 'PENDING';
}

export function isActiveGatewayStatus(status) {
  return ACTIVE_STATUSES.has(normalizeGatewayStatus(status));
}

export function isTerminalGatewayStatus(status) {
  return TERMINAL_STATUSES.has(normalizeGatewayStatus(status));
}

export function gatewayReadiness(env = {}) {
  const provider = String(env.PAYMENT_GATEWAY_PROVIDER || '').trim().toUpperCase();
  if (!provider || provider === 'UNCONFIGURED') {
    return { configured: false, provider: 'UNCONFIGURED', reason: 'Provider payment gateway belum dipilih.' };
  }
  if (provider === 'MOCK') {
    const enabled = String(env.PAYMENT_GATEWAY_ALLOW_MOCK || '').toLowerCase() === 'true';
    return { configured: enabled, provider, reason: enabled ? null : 'MOCK adapter dinonaktifkan. Set PAYMENT_GATEWAY_ALLOW_MOCK=true hanya untuk UAT.' };
  }
  return { configured: false, provider, reason: `Adapter ${provider} belum tersedia. Tambahkan adapter sesuai spesifikasi resmi provider sebelum production.` };
}

export function gatewayIdempotencyKey(paymentInstruction) {
  const hash = String(paymentInstruction?.content_hash || '').trim();
  if (!paymentInstruction?.id || !hash) throw new Error('Payment Instruction id dan content hash wajib tersedia');
  return `PG-${paymentInstruction.id}-${hash.slice(0, 32)}`;
}

export async function gatewayRequestHash(paymentInstruction, lineHashes = [], paymentMethod = '') {
  const canonical = {
    paymentInstructionId: String(paymentInstruction.id),
    contentHash: String(paymentInstruction.content_hash),
    amount: Number(paymentInstruction.expected_total),
    currency: String(paymentInstruction.currency || 'IDR').toUpperCase(),
    paymentMethod: String(paymentMethod || '').trim().toUpperCase(),
    lineHashes: [...lineHashes].map(String).sort(),
  };
  return sha256Hex(JSON.stringify(canonical));
}

export async function hmacSha256Hex(secret, rawBody) {
  if (!secret) throw new PaymentGatewayConfigurationError('PAYMENT_GATEWAY_WEBHOOK_SECRET belum dikonfigurasi');
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(String(rawBody)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export async function verifyMockWebhookSignature(env, rawBody, signature) {
  const expected = await hmacSha256Hex(env.PAYMENT_GATEWAY_WEBHOOK_SECRET, rawBody);
  return safeEqual(expected, String(signature || '').replace(/^sha256=/i, ''));
}

function assertMockAllowed(env) {
  const readiness = gatewayReadiness(env);
  if (!readiness.configured || readiness.provider !== 'MOCK') throw new PaymentGatewayConfigurationError(readiness.reason || 'Gateway belum siap');
}

export async function createGatewayPayment(env, request) {
  assertMockAllowed(env);
  return {
    provider: 'MOCK',
    providerTransactionId: `MOCK-${crypto.randomUUID()}`,
    providerReference: request.paymentInstructionId,
    status: 'PROCESSING',
    providerStatus: 'PROCESSING',
  };
}

export async function parseGatewayWebhook(env, rawBody, headers) {
  const readiness = gatewayReadiness(env);
  if (!readiness.configured || readiness.provider !== 'MOCK') throw new PaymentGatewayConfigurationError(readiness.reason || 'Gateway belum siap');
  const signature = headers.get('x-payment-signature');
  if (!await verifyMockWebhookSignature(env, rawBody, signature)) return { signatureValid: false };
  const payload = JSON.parse(rawBody || '{}');
  const eventId = String(payload.eventId || '').trim();
  const providerTransactionId = String(payload.transactionId || '').trim();
  if (!eventId || !providerTransactionId) throw new Error('Webhook eventId dan transactionId wajib tersedia');
  return {
    signatureValid: true,
    provider: 'MOCK',
    eventId,
    eventType: String(payload.type || 'payment.status').slice(0, 80),
    providerTransactionId,
    status: normalizeGatewayStatus(payload.status),
    providerStatus: String(payload.status || '').slice(0, 80),
    amount: Number(payload.amount || 0),
    currency: String(payload.currency || 'IDR').toUpperCase(),
    safePayload: {
      eventId,
      transactionId: providerTransactionId,
      type: String(payload.type || 'payment.status').slice(0, 80),
      status: String(payload.status || '').slice(0, 80),
      amount: Number(payload.amount || 0),
      currency: String(payload.currency || 'IDR').toUpperCase(),
    },
  };
}
