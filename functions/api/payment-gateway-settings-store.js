import { d1First, d1Run } from './_d1.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export async function readGatewaySecureSettings(database, env, organizationId) {
  const row = await d1First(database,
    'SELECT * FROM gateway_secure_settings WHERE org_id=? LIMIT 1',
    [organizationId]);
  if (!row) return {
    exists:false,
    provider:'UNCONFIGURED',
    environment:'UAT',
    credentials:{},
    updatedBy:null,
    updatedAt:null,
  };
  return {
    exists:true,
    provider:String(row.provider || 'UNCONFIGURED').toUpperCase(),
    environment:String(row.environment || 'UAT').toUpperCase(),
    credentials:await decryptCredentials(env, row),
    updatedBy:row.updated_by || null,
    updatedAt:row.updated_at || null,
  };
}

export async function writeGatewaySecureSettings(database, env, organizationId, actorEmail, input) {
  const current = await readGatewaySecureSettings(database, env, organizationId);
  const provider = String(input.provider || current.provider || 'UNCONFIGURED').toUpperCase();
  const environment = String(input.environment || current.environment || 'UAT').toUpperCase();
  const credentials = { ...current.credentials, ...(input.credentials || {}) };
  const encrypted = await encryptCredentials(env, credentials);
  await d1Run(database, `INSERT INTO gateway_secure_settings
    (org_id,provider,environment,credentials_ciphertext,credentials_iv,credential_version,updated_by,updated_at)
    VALUES(?,?,?,?,?,1,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(org_id) DO UPDATE SET
      provider=excluded.provider,
      environment=excluded.environment,
      credentials_ciphertext=excluded.credentials_ciphertext,
      credentials_iv=excluded.credentials_iv,
      credential_version=gateway_secure_settings.credential_version+1,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at`,
    [organizationId, provider, environment, encrypted.ciphertext, encrypted.iv, actorEmail]);
  return readGatewaySecureSettings(database, env, organizationId);
}

export async function gatewayRuntimeEnv(database, env, organizationId) {
  let stored;
  try {
    stored = await readGatewaySecureSettings(database, env, organizationId);
  } catch (error) {
    if (/no such table: gateway_secure_settings/i.test(String(error?.message || error))) return env;
    throw error;
  }
  if (!stored?.exists) return env;
  const overrides = {
    PAYMENT_GATEWAY_PROVIDER:stored.provider,
    E2PAY_ENV:stored.environment,
    E2PAY_CLIENT_ID:String(stored.credentials.clientId || ''),
    E2PAY_CLIENT_SECRET:String(stored.credentials.clientSecret || ''),
    E2PAY_USERNAME:String(stored.credentials.username || ''),
    E2PAY_PASSWORD_MD5:String(stored.credentials.passwordMd5 || ''),
    E2PAY_ACCOUNT_SRC:String(stored.credentials.accountSrc || ''),
    E2PAY_SOURCE_ID:String(stored.credentials.sourceId || ''),
  };
  return Object.assign(Object.create(env || null), overrides);
}

function masked(value) {
  const text = String(value || '');
  if (!text) return null;
  if (text.length <= 4) return '••••';
  return '••••' + text.slice(-4);
}

export function publicGatewaySettings(stored) {
  const credentials = stored?.credentials || {};
  return {
    provider:stored?.provider || 'UNCONFIGURED',
    environment:stored?.environment || 'UAT',
    stored:{
      clientId:Boolean(credentials.clientId),
      clientSecret:Boolean(credentials.clientSecret),
      username:Boolean(credentials.username),
      passwordMd5:Boolean(credentials.passwordMd5),
      accountSrc:Boolean(credentials.accountSrc),
      sourceId:Boolean(credentials.sourceId),
    },
    masked:{
      clientId:masked(credentials.clientId),
      clientSecret:credentials.clientSecret ? '••••••••' : null,
      username:masked(credentials.username),
      passwordMd5:credentials.passwordMd5 ? '••••••••' : null,
      accountSrc:masked(credentials.accountSrc),
      sourceId:masked(credentials.sourceId),
    },
    updatedBy:stored?.updatedBy || null,
    updatedAt:stored?.updatedAt || null,
  };
}
