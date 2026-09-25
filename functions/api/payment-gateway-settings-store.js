import { d1First, d1Run } from './_d1.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ENVIRONMENTS = ['UAT','PRODUCTION'];
const PROVIDERS = ['UNCONFIGURED','E2PAY'];

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(env) {
  const secret = String(env.E2PAY_CREDENTIALS_KEY || env.PI_ENCRYPTION_KEY || '');
  if (secret.length < 32) {
    throw new Error('E2PAY_CREDENTIALS_KEY atau PI_ENCRYPTION_KEY minimal 32 karakter diperlukan');
  }
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt','decrypt']);
}

async function encryptCredentials(env, credentials) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encoder.encode(JSON.stringify(credentials || {}));
  const cipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, await encryptionKey(env), plain);
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipher)),
    iv: bytesToBase64(iv),
  };
}

async function decryptCredentials(env, row) {
  if (!row?.credentials_ciphertext || !row?.credentials_iv) return {};
  const plain = await crypto.subtle.decrypt(
    { name:'AES-GCM', iv:base64ToBytes(row.credentials_iv) },
    await encryptionKey(env),
    base64ToBytes(row.credentials_ciphertext),
  );
  const parsed = JSON.parse(decoder.decode(plain));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function normalizeEnvironment(value, fallback = 'UAT') {
  const normalized = String(value || fallback).trim().toUpperCase();
  return ENVIRONMENTS.includes(normalized) ? normalized : fallback;
}

function normalizeProvider(value, fallback = 'UNCONFIGURED') {
  const normalized = String(value || fallback).trim().toUpperCase();
  return PROVIDERS.includes(normalized) ? normalized : fallback;
}

function normalizeProfiles(raw, activeEnvironment) {
  if (raw?.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles)) {
    return {
      UAT: raw.profiles.UAT && typeof raw.profiles.UAT === 'object' ? raw.profiles.UAT : {},
      PRODUCTION: raw.profiles.PRODUCTION && typeof raw.profiles.PRODUCTION === 'object' ? raw.profiles.PRODUCTION : {},
    };
  }
  return {
    UAT: activeEnvironment === 'UAT' ? raw || {} : {},
    PRODUCTION: activeEnvironment === 'PRODUCTION' ? raw || {} : {},
  };
}

export async function readGatewaySecureSettings(database, env, organizationId) {
  const row = await d1First(database,
    'SELECT * FROM gateway_secure_settings WHERE org_id=? LIMIT 1',
    [organizationId]);
  if (!row) return {
    exists:false,
    provider:'UNCONFIGURED',
    environment:'UAT',
    draftProvider:'UNCONFIGURED',
    draftEnvironment:'UAT',
    credentials:{},
    credentialProfiles:{ UAT:{}, PRODUCTION:{} },
    activatedBy:null,
    activatedAt:null,
    updatedBy:null,
    updatedAt:null,
  };

  const environment = normalizeEnvironment(row.environment);
  const provider = normalizeProvider(row.provider);
  const draftEnvironment = normalizeEnvironment(row.draft_environment, environment);
  const draftProvider = normalizeProvider(row.draft_provider, provider);
  const raw = await decryptCredentials(env, row);
  const credentialProfiles = normalizeProfiles(raw, environment);
  return {
    exists:true,
    provider,
    environment,
    draftProvider,
    draftEnvironment,
    credentials:credentialProfiles[environment] || {},
    credentialProfiles,
    activatedBy:row.activated_by || null,
    activatedAt:row.activated_at || null,
    updatedBy:row.updated_by || null,
    updatedAt:row.updated_at || null,
  };
}

async function persistGatewaySecureSettings(database, env, organizationId, actorEmail, input, activate) {
  const current = await readGatewaySecureSettings(database, env, organizationId);
  const draftProvider = normalizeProvider(input.provider, current.draftProvider || current.provider);
  const draftEnvironment = normalizeEnvironment(input.environment, current.draftEnvironment || current.environment);
  const activeProvider = activate ? draftProvider : current.provider;
  const activeEnvironment = activate ? draftEnvironment : current.environment;
  const credentialProfiles = {
    UAT:{ ...(current.credentialProfiles?.UAT || {}) },
    PRODUCTION:{ ...(current.credentialProfiles?.PRODUCTION || {}) },
  };
  credentialProfiles[draftEnvironment] = {
    ...credentialProfiles[draftEnvironment],
    ...(input.credentials || {}),
  };

  const encrypted = await encryptCredentials(env, { profiles:credentialProfiles });
  await d1Run(database, `INSERT INTO gateway_secure_settings
    (org_id,provider,environment,draft_provider,draft_environment,credentials_ciphertext,credentials_iv,credential_version,updated_by,updated_at,activated_by,activated_at)
    VALUES(?,?,?,?,?,?,?,1,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END)
    ON CONFLICT(org_id) DO UPDATE SET
      provider=excluded.provider,
      environment=excluded.environment,
      draft_provider=excluded.draft_provider,
      draft_environment=excluded.draft_environment,
      credentials_ciphertext=excluded.credentials_ciphertext,
      credentials_iv=excluded.credentials_iv,
      credential_version=gateway_secure_settings.credential_version+1,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at,
      activated_by=CASE WHEN ? THEN excluded.activated_by ELSE gateway_secure_settings.activated_by END,
      activated_at=CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE gateway_secure_settings.activated_at END`,
    [
      organizationId,
      activeProvider,
      activeEnvironment,
      draftProvider,
      draftEnvironment,
      encrypted.ciphertext,
      encrypted.iv,
      actorEmail,
      activate ? actorEmail : null,
      activate ? 1 : 0,
      activate ? 1 : 0,
      activate ? 1 : 0,
    ]);
  return readGatewaySecureSettings(database, env, organizationId);
}

export async function writeGatewaySecureSettings(database, env, organizationId, actorEmail, input) {
  return persistGatewaySecureSettings(database, env, organizationId, actorEmail, input, false);
}

export async function activateGatewaySecureSettings(database, env, organizationId, actorEmail, input) {
  return persistGatewaySecureSettings(database, env, organizationId, actorEmail, input, true);
}

export async function gatewayRuntimeEnv(database, env, organizationId, environmentOverride = null) {
  let stored;
  try {
    stored = await readGatewaySecureSettings(database, env, organizationId);
  } catch (error) {
    if (/no such table: gateway_secure_settings/i.test(String(error?.message || error))) return env;
    throw error;
  }
  if (!stored?.exists) return env;

  const environment = normalizeEnvironment(environmentOverride, stored.environment);
  const credentials = stored.credentialProfiles?.[environment] || {};
  const overrides = {
    PAYMENT_GATEWAY_PROVIDER:stored.provider,
    E2PAY_ENV:environment,
    E2PAY_MERCHANT_NAME:String(credentials.merchantName || ''),
    E2PAY_CLIENT_ID:String(credentials.clientId || ''),
    E2PAY_CLIENT_SECRET:String(credentials.clientSecret || ''),
    E2PAY_PARTNER_ID:String(credentials.partnerId || ''),
    E2PAY_SOURCE_ID:String(credentials.sourceId || ''),
    E2PAY_MERCHANT_ID:String(credentials.merchantId || ''),
    E2PAY_USERNAME:String(credentials.username || ''),
    E2PAY_PASSWORD_MD5:String(credentials.passwordMd5 || ''),
    E2PAY_ACCOUNT_SRC:String(credentials.accountSrc || ''),
  };
  return Object.assign(Object.create(env || null), overrides);
}

function masked(value) {
  const text = String(value || '');
  if (!text) return null;
  if (text.length <= 4) return '••••';
  return '••••' + text.slice(-4);
}

function profileSummary(credentials = {}) {
  return {
    stored:{
      merchantName:Boolean(credentials.merchantName),
      clientId:Boolean(credentials.clientId),
      clientSecret:Boolean(credentials.clientSecret),
      partnerId:Boolean(credentials.partnerId),
      sourceId:Boolean(credentials.sourceId),
      merchantId:Boolean(credentials.merchantId),
      username:Boolean(credentials.username),
      passwordMd5:Boolean(credentials.passwordMd5),
      accountSrc:Boolean(credentials.accountSrc),
    },
    masked:{
      merchantName:credentials.merchantName ? String(credentials.merchantName) : null,
      clientId:masked(credentials.clientId),
      clientSecret:credentials.clientSecret ? '••••••••' : null,
      partnerId:masked(credentials.partnerId),
      sourceId:masked(credentials.sourceId),
      merchantId:masked(credentials.merchantId),
      username:masked(credentials.username),
      passwordMd5:credentials.passwordMd5 ? '••••••••' : null,
      accountSrc:masked(credentials.accountSrc),
    },
  };
}

export function publicGatewaySettings(stored) {
  const profiles = stored?.credentialProfiles || { UAT:{}, PRODUCTION:{} };
  const draftEnvironment = stored?.draftEnvironment || stored?.environment || 'UAT';
  const draft = profileSummary(profiles[draftEnvironment] || {});
  return {
    provider:stored?.provider || 'UNCONFIGURED',
    environment:stored?.environment || 'UAT',
    activeProvider:stored?.provider || 'UNCONFIGURED',
    activeEnvironment:stored?.environment || 'UAT',
    draftProvider:stored?.draftProvider || stored?.provider || 'UNCONFIGURED',
    draftEnvironment,
    ...draft,
    profiles:{
      UAT:profileSummary(profiles.UAT || {}),
      PRODUCTION:profileSummary(profiles.PRODUCTION || {}),
    },
    activatedBy:stored?.activatedBy || null,
    activatedAt:stored?.activatedAt || null,
    updatedBy:stored?.updatedBy || null,
    updatedAt:stored?.updatedAt || null,
  };
}
