import { PaymentGatewayConfigurationError, gatewayReadiness } from './payment-gateway-core.js';
import { sha256Hex } from './payment-instruction-core.js';

const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function hostedReadiness(env = {}) {
  const gateway = gatewayReadiness(env);
  if (!gateway.configured) return { configured: false, provider: gateway.provider, reason: gateway.reason };
  const enabled = String(env.PAYMENT_GATEWAY_HOSTED_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { configured: false, provider: gateway.provider, reason: 'Hosted payment dinonaktifkan. Set PAYMENT_GATEWAY_HOSTED_ENABLED=true setelah adapter hosted siap.' };
  if (gateway.provider === 'MOCK') return { configured: true, provider: 'MOCK', reason: null };
  return { configured: false, provider: gateway.provider, reason: `Hosted adapter ${gateway.provider} belum tersedia.` };
}

export function hostedSessionTtlSeconds(env = {}) {
  const raw = Number(env.PAYMENT_GATEWAY_HOSTED_TTL_SECONDS || 900);
  if (!Number.isFinite(raw)) return 900;
  return Math.max(300, Math.min(3600, Math.floor(raw)));
}

export function normalizeReturnPath(value) {
  const path = String(value || '/').trim();
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) throw new Error('returnPath harus berupa relative path aplikasi');
  return path.slice(0, 500);
}

export function allowedReturnPath(env = {}, value) {
  const path = normalizeReturnPath(value);
  const configured = String(env.PAYMENT_GATEWAY_HOSTED_RETURN_PREFIXES || '/,/operations,/payments')
    .split(',').map((item) => item.trim()).filter(Boolean);
  const allowed = configured.some((prefix) => prefix === '/' ? path.startsWith('/') : path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
  if (!allowed) throw new Error('returnPath tidak termasuk allowlist Hosted Payment');
  return path;
}

export function generateHostedState() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hostedStateHash(state) {
  if (!state || String(state).length < 32) throw new Error('Hosted state tidak valid');
  return sha256Hex(String(state));
}

export async function createHostedCheckout(env, request) {
  const readiness = hostedReadiness(env);
  if (!readiness.configured || readiness.provider !== 'MOCK') throw new PaymentGatewayConfigurationError(readiness.reason || 'Hosted gateway belum siap');
  const origin = String(env.PAYMENT_GATEWAY_MOCK_HOSTED_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!origin) throw new PaymentGatewayConfigurationError('PAYMENT_GATEWAY_MOCK_HOSTED_ORIGIN wajib diisi untuk UAT Hosted MOCK');
  const providerSessionId = `MOCK-HOSTED-${crypto.randomUUID()}`;
  const checkoutUrl = `${origin}/checkout?session=${encodeURIComponent(providerSessionId)}&state=${encodeURIComponent(request.state)}`;
  return { provider: 'MOCK', providerSessionId, checkoutUrl, status: 'READY' };
}

export async function validateHostedReturn({ state, expectedStateHash }) {
  if (!state || !expectedStateHash) return false;
  const actual = await hostedStateHash(state);
  const left = encoder.encode(actual);
  const right = encoder.encode(String(expectedStateHash));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}
