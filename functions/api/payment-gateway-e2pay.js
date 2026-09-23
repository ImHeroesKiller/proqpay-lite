import { sha256Hex } from './payment-instruction-core.js';

const UAT_BASE_URL = 'https://disbursementtest.mbayar.co.id/switching';
const PROD_BASE_URL = 'https://disbursement.mbayar.co.id/switching';
const encoder = new TextEncoder();

export class E2PayConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'E2PayConfigurationError';
  }
}

export class E2PayRequestError extends Error {
  constructor(message, code = 'E2PAY_REQUEST_FAILED', httpStatus = null) {
    super(message);
    this.name = 'E2PayRequestError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function required(env, key) {
  return String(env?.[key] || '').trim();
}

export function e2payHostReadiness(env = {}) {
  const mode = String(env.E2PAY_ENV || 'UAT').trim().toUpperCase();
  const missing = ['E2PAY_CLIENT_ID','E2PAY_CLIENT_SECRET'].filter((key) => !required(env, key));
  if (!['UAT','PRODUCTION'].includes(mode)) {
    return { configured:false, provider:'E2PAY', reason:'E2PAY_ENV wajib UAT atau PRODUCTION.' };
  }
  if (missing.length) {
    return { configured:false, provider:'E2PAY', reason:`Credential host E2Pay belum lengkap: ${missing.join(', ')}.`, environment:mode };
  }
  return { configured:true, provider:'E2PAY', reason:null, environment:mode };
}

export function e2payReadiness(env = {}) {
  const host = e2payHostReadiness(env);
  const mode = String(env.E2PAY_ENV || 'UAT').trim().toUpperCase();
  const missing = [
    'E2PAY_USERNAME',
    'E2PAY_PASSWORD_MD5',
    'E2PAY_ACCOUNT_SRC',
    'E2PAY_SOURCE_ID',
  ].filter((key) => !required(env, key));
  if (!host.configured) return host;
  if (missing.length) {
    return {
      configured:false,
      provider:'E2PAY',
      environment:mode,
      hostConfigured:true,
      reason:`Host credential valid secara struktur, tetapi execution belum siap: ${missing.join(', ')} belum tersedia dari merchant registration/login.`,
    };
  }
  if (!/^[A-F0-9]{32}$/.test(required(env, 'E2PAY_PASSWORD_MD5'))) {
    return { configured:false, provider:'E2PAY', reason:'E2PAY_PASSWORD_MD5 wajib berupa MD5 uppercase 32 karakter.' };
  }
  return { configured:true, provider:'E2PAY', reason:null, environment:mode };
}

export function e2payBaseUrl(env = {}) {
  const mode = String(env.E2PAY_ENV || 'UAT').trim().toUpperCase();
  if (mode === 'PRODUCTION') return PROD_BASE_URL;
  if (mode === 'UAT') return UAT_BASE_URL;
  throw new E2PayConfigurationError('E2PAY_ENV wajib UAT atau PRODUCTION');
}

function timeoutMs(env) {
  const value = Number(env.E2PAY_TIMEOUT_MS || 15000);
  if (!Number.isFinite(value)) return 15000;
  return Math.max(3000, Math.min(60000, Math.floor(value)));
}

async function requestJson(env, path, init = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(env));
  try {
    const response = await fetchImpl(`${e2payBaseUrl(env)}${path}`, {
      ...init,
      headers: { Accept:'application/json', ...(init.headers || {}) },
      signal: controller.signal,
    });
    const text = await response.text();
    let body = {};
    if (text) {
      try { body = JSON.parse(text); }
      catch { throw new E2PayRequestError('Response E2Pay bukan JSON valid', 'E2PAY_INVALID_JSON', response.status); }
    }
    if (!response.ok) throw new E2PayRequestError(`E2Pay HTTP ${response.status}`, 'E2PAY_HTTP_ERROR', response.status);
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') throw new E2PayRequestError('Request E2Pay timeout', 'E2PAY_TIMEOUT');
    if (error instanceof E2PayRequestError) throw error;
    throw new E2PayRequestError('Koneksi ke E2Pay gagal', 'E2PAY_NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

export async function e2payHostAuthorize(env, fetchImpl = fetch) {
  const readiness = e2payHostReadiness(env);
  if (!readiness.configured) throw new E2PayConfigurationError(readiness.reason);
  const form = new URLSearchParams({
    client_id:required(env, 'E2PAY_CLIENT_ID'),
    client_secret:required(env, 'E2PAY_CLIENT_SECRET'),
    grant_type:'client_credentials',
  });
  const token = await requestJson(env, '/rest/oauth/token', {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:form.toString(),
  }, fetchImpl);
  const accessToken = String(token?.access_token || '').trim();
  if (!accessToken) throw new E2PayRequestError('Host access token E2Pay tidak tersedia', 'E2PAY_HOST_ACCESS_TOKEN_MISSING');
  return {
    accessToken,
    tokenType:String(token?.token_type || 'Bearer'),
    expiresIn:Number(token?.expires_in || 0) || null,
    refreshToken:String(token?.refresh_token || '') || null,
  };
}

export async function e2payAuthorize(env, fetchImpl = fetch) {
  const readiness = e2payReadiness(env);
  if (!readiness.configured) throw new E2PayConfigurationError(readiness.reason);
  const clientId = required(env, 'E2PAY_CLIENT_ID');
  const clientSecret = required(env, 'E2PAY_CLIENT_SECRET');
  const authorization = await requestJson(env, '/rest/h2h/authorization/', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({
      client_id:clientId,
      client_secret:clientSecret,
      response_type:'code',
      username:required(env, 'E2PAY_USERNAME'),
      password:required(env, 'E2PAY_PASSWORD_MD5'),
    }),
  }, fetchImpl);
  const code = String(authorization?.code || '').trim();
  if (!code) throw new E2PayRequestError('Authorization code E2Pay tidak tersedia', 'E2PAY_AUTH_CODE_MISSING');

  const form = new URLSearchParams({
    client_id:clientId,
    client_secret:clientSecret,
    grant_type:'authorization_code',
    code,
  });
  const token = await requestJson(env, '/rest/oauth/token', {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:form.toString(),
  }, fetchImpl);
  const accessToken = String(token?.access_token || '').trim();
  if (!accessToken) throw new E2PayRequestError('Access token E2Pay tidak tersedia', 'E2PAY_ACCESS_TOKEN_MISSING');
  return {
    accessToken,
    tokenType:String(token?.token_type || 'Bearer'),
    expiresIn:Number(token?.expires_in || 0) || null,
    refreshToken:String(token?.refresh_token || '') || null,
  };
}

function bearer(accessToken) {
  if (!accessToken) throw new E2PayConfigurationError('E2Pay access token wajib tersedia');
  return { Authorization:`Bearer ${accessToken}` };
}

export async function e2payMerchantAccount(env, accessToken, fetchImpl = fetch) {
  return requestJson(env, '/b2b/merchant/me/account', {
    method:'GET',
    headers:bearer(accessToken),
  }, fetchImpl);
}

export async function e2payBankList(env, accessToken, fetchImpl = fetch) {
  const params = new URLSearchParams({ limit:'1000', sortField:'name', sortOrder:'ASCENDING' });
  const result = await requestJson(env, `/b2b/bank/sdp?${params}`, {
    method:'GET',
    headers:bearer(accessToken),
  }, fetchImpl);
  return Array.isArray(result?.data) ? result.data : [];
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function e2payInquirySignature(clientSecret, accountId, bankId, amount) {
  const amountText = String(Math.trunc(Number(amount)));
  const stringToSign = `${String(accountId)}:${String(bankId)}:${amountText}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(clientSecret)),
    { name:'HMAC', hash:'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
  return bytesToBase64(new Uint8Array(signature));
}

export function normalizeE2PayBankKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function resolveE2PayBank(bankList, beneficiary) {
  const rows = Array.isArray(bankList) ? bankList.filter((row) => String(row?.active ?? 'true').toLowerCase() !== 'false') : [];
  const codeKey = normalizeE2PayBankKey(beneficiary?.bankCode);
  if (codeKey) {
    const byId = rows.find((row) => normalizeE2PayBankKey(row.id) === codeKey);
    if (byId) return byId;
  }
  const nameKey = normalizeE2PayBankKey(beneficiary?.bankName);
  if (nameKey) {
    const byName = rows.find((row) => normalizeE2PayBankKey(row.name) === nameKey);
    if (byName) return byName;
  }
  return null;
}

export async function e2payInquiry(env, accessToken, input, fetchImpl = fetch) {
  const accountId = String(input.accountId || '').trim();
  const bankId = String(input.bankId || '').trim();
  const amount = Math.trunc(Number(input.amount || 0));
  if (!accountId || !bankId || amount <= 0) throw new E2PayRequestError('Payload inquiry E2Pay tidak valid', 'E2PAY_INQUIRY_INVALID');
  const signature = await e2payInquirySignature(required(env, 'E2PAY_CLIENT_SECRET'), accountId, bankId, amount);
  const params = new URLSearchParams({ accountId, bankId, amount:String(amount) });
  return requestJson(env, `/b2b/merchant/me/sdp/inquiry?${params}`, {
    method:'GET',
    headers:{ ...bearer(accessToken), Signature:signature },
  }, fetchImpl);
}

export function e2payResponseStatus(responseCode) {
  const code = String(responseCode ?? '').trim();
  if (code === '00') return 'SUCCEEDED';
  if (code === '96') return 'PROCESSING';
  if (code === '99') return 'FAILED';
  // Any missing or undocumented response code is unresolved, never success.
  return 'PENDING';
}

export async function e2payClientRef(paymentInstruction, line) {
  const digest = await sha256Hex(`${paymentInstruction.id}:${line.id}:${paymentInstruction.content_hash}`);
  return `PQP-${digest.slice(0, 32)}`;
}

export async function e2payDisburse(env, accessToken, input, fetchImpl = fetch) {
  const payload = {
    accountSrc:required(env, 'E2PAY_ACCOUNT_SRC'),
    clientRef:String(input.clientRef || '').trim(),
    description:String(input.description || '').trim().slice(0, 120),
    password:required(env, 'E2PAY_PASSWORD_MD5'),
    inquiryId:String(input.inquiryId || '').trim(),
    sourceId:required(env, 'E2PAY_SOURCE_ID'),
  };
  if (!payload.clientRef || !payload.inquiryId) throw new E2PayRequestError('Payload transaksi E2Pay tidak valid', 'E2PAY_TRANSACTION_INVALID');
  // Financial POST is deliberately never auto-retried. A timeout is ambiguous and
  // must be resolved through transaction history using the stable clientRef.
  return requestJson(env, '/b2b/merchant/me/sdp/transaction', {
    method:'POST',
    headers:{ ...bearer(accessToken), 'Content-Type':'application/json' },
    body:JSON.stringify(payload),
  }, fetchImpl);
}

export async function e2payTransactionHistory(env, accessToken, clientRef, fetchImpl = fetch) {
  const params = new URLSearchParams({
    limit:'20',
    offset:'0',
    sortField:'transactionTimestamp',
    sortOrder:'DESCENDING',
    clientRef:String(clientRef || ''),
  });
  const result = await requestJson(env, `/b2b/merchant/me/transaction?${params}`, {
    method:'GET',
    headers:bearer(accessToken),
  }, fetchImpl);
  const rows = Array.isArray(result?.data) ? result.data : [];
  return rows.find((row) => String(row?.clientRef || '') === String(clientRef || '')) || null;
}

export function e2paySyncBeneficiaryLimit(env = {}) {
  const raw = Number(env.E2PAY_MAX_SYNC_BENEFICIARIES || 25);
  if (!Number.isFinite(raw)) return 25;
  return Math.max(1, Math.min(100, Math.floor(raw)));
}
