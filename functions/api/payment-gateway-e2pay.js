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
function add32(a,b){ return (a+b)>>>0; }
function rol(value,shift){ return ((value<<shift)|(value>>>(32-shift)))>>>0; }
function md5Round(a,b,c,d,x,s,t,fn){ return add32(rol(add32(add32(a,fn(b,c,d)),add32(x,t)),s),b); }

export function e2payPasswordMd5(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >>> 6) + 1) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const low = bitLength >>> 0;
  const high = Math.floor(bitLength / 0x100000000) >>> 0;
  view.setUint32(paddedLength - 8, low, true);
  view.setUint32(paddedLength - 4, high, true);

  let a0=0x67452301, b0=0xefcdab89, c0=0x98badcfe, d0=0x10325476;
  const s=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const k=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*0x100000000)>>>0);
  for(let offset=0; offset<paddedLength; offset+=64){
    const m=Array.from({length:16},(_,i)=>view.getUint32(offset+i*4,true));
    let a=a0,b=b0,c=c0,d=d0;
    for(let i=0;i<64;i++){
      let g,fn;
      if(i<16){ fn=(x,y,z)=>(x&y)|(~x&z); g=i; }
      else if(i<32){ fn=(x,y,z)=>(x&z)|(y&~z); g=(5*i+1)%16; }
      else if(i<48){ fn=(x,y,z)=>x^y^z; g=(3*i+5)%16; }
      else { fn=(x,y,z)=>y^(x|~z); g=(7*i)%16; }
      const next=md5Round(a,b,c,d,m[g],s[i],k[i],fn);
      a=d; d=c; c=b; b=next;
    }
    a0=add32(a0,a); b0=add32(b0,b); c0=add32(c0,c); d0=add32(d0,d);
  }
  const out=new Uint8Array(16);
  const outView=new DataView(out.buffer);
  outView.setUint32(0,a0,true); outView.setUint32(4,b0,true); outView.setUint32(8,c0,true); outView.setUint32(12,d0,true);
  return [...out].map((byte)=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
}

export function normalizeE2PayPassword(value) {
  const text=String(value ?? '').trim();
  if (!text) return '';
  return /^[A-Fa-f0-9]{32}$/.test(text) ? text.toUpperCase() : e2payPasswordMd5(text);
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

export function e2payLoginReadiness(env = {}) {
  const host = e2payHostReadiness(env);
  if (!host.configured) return host;
  const missing = ['E2PAY_USERNAME','E2PAY_PASSWORD_MD5'].filter((key)=>!required(env,key));
  if (missing.length) {
    return {
      configured:false,
      provider:'E2PAY',
      environment:host.environment,
      hostConfigured:true,
      reason:`Merchant login belum siap: ${missing.join(', ')} belum tersedia.`,
    };
  }
  if (!/^[A-F0-9]{32}$/.test(required(env,'E2PAY_PASSWORD_MD5'))) {
    return { configured:false, provider:'E2PAY', environment:host.environment, hostConfigured:true, reason:'E2PAY_PASSWORD_MD5 wajib berupa MD5 uppercase 32 karakter.' };
  }
  return { configured:true, provider:'E2PAY', environment:host.environment, hostConfigured:true, reason:null };
}

export function e2payReadiness(env = {}) {
  const login = e2payLoginReadiness(env);
  if (!login.configured) return login;
  const missing = ['E2PAY_ACCOUNT_SRC','E2PAY_SOURCE_ID'].filter((key)=>!required(env,key));
  if (missing.length) {
    return {
      configured:false,
      provider:'E2PAY',
      environment:login.environment,
      hostConfigured:true,
      loginConfigured:true,
      reason:`Merchant login valid secara struktur, tetapi execution belum siap: ${missing.join(', ')} belum tersedia.`,
    };
  }
  return { configured:true, provider:'E2PAY', reason:null, environment:login.environment, hostConfigured:true, loginConfigured:true };
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
  const readiness = e2payLoginReadiness(env);
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

export async function e2payVerifyUsername(env, hostAccessToken, username, fetchImpl = fetch) {
  const value=String(username || '').trim();
  if (!value) throw new E2PayRequestError('Username merchant E2Pay wajib tersedia', 'E2PAY_USERNAME_REQUIRED');
  const params=new URLSearchParams({ username:value });
  return requestJson(env, `/b2b/merchant/auth/verifyUsername?${params}`, {
    method:'GET',
    headers:bearer(hostAccessToken),
  }, fetchImpl);
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
