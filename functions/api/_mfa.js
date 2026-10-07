import { d1First, d1Run } from './_d1.js';
import { SESSION_COOKIE, constantTimeEqual } from './_account-auth.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const value = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let buffer = 0;
  const output = [];
  for (const char of value) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

function mfaSecret(env = {}) {
  const secret = String(env.SECURITY_MFA_KEY || env.SECURITY_CONTEXT_KEY || env.PI_ENCRYPTION_KEY || '');
  if (secret.length < 32) throw new Error('SECURITY_MFA_KEY minimal 32 karakter diperlukan');
  return secret;
}

async function encryptionKey(env) {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(mfaSecret(env)));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt','decrypt']);
}

async function encryptSecret(secret, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name:'AES-GCM', iv },
    await encryptionKey(env),
    encoder.encode(secret),
  );
  return { ciphertext:bytesToBase64(new Uint8Array(cipher)), iv:bytesToBase64(iv) };
}

async function decryptSecret(row, env) {
  const plain = await crypto.subtle.decrypt(
    { name:'AES-GCM', iv:base64ToBytes(row.secret_iv) },
    await encryptionKey(env),
    base64ToBytes(row.secret_ciphertext),
  );
  return decoder.decode(plain);
}

async function sha256Base64Url(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))));
  return bytesToBase64(digest).replaceAll('+','-').replaceAll('/','_').replace(/=+$/g,'');
}

function cookieValue(request, name) {
  for (const cookie of String(request.headers.get('Cookie') || '').split(';')) {
    const [key, ...rest] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function hotp(secret, counter) {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name:'HMAC', hash:'SHA-1' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(8);
  let value = Math.max(0, Math.floor(Number(counter) || 0));
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = value % 256;
    value = Math.floor(value / 256);
  }
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

export async function readUserMfa(database, userId) {
  return d1First(database, 'SELECT * FROM app_user_mfa WHERE user_id=? LIMIT 1', [userId]);
}

export async function beginMfaEnrollment(database, env, user) {
  const current = await readUserMfa(database, user.id);
  if (current?.status === 'ACTIVE') return { alreadyActive:true };
  const secretBytes = crypto.getRandomValues(new Uint8Array(20));
  const secret = base32Encode(secretBytes);
  const encrypted = await encryptSecret(secret, env);
  await d1Run(database, `INSERT INTO app_user_mfa
    (user_id,secret_ciphertext,secret_iv,status,enrolled_at,updated_at)
    VALUES (?,?,?,'PENDING',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(user_id) DO UPDATE SET
      secret_ciphertext=excluded.secret_ciphertext,
      secret_iv=excluded.secret_iv,
      status='PENDING',
      enrolled_at=excluded.enrolled_at,
      activated_at=NULL,
      last_verified_at=NULL,
      updated_at=excluded.updated_at`,
    [user.id, encrypted.ciphertext, encrypted.iv]);
  const issuer = encodeURIComponent('ProQPay');
  const label = encodeURIComponent(`ProQPay:${String(user.email || user.id)}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

export async function verifyUserMfa(database, env, userId, code, { allowPending = false } = {}) {
  const row = await readUserMfa(database, userId);
  if (!row) return { ok:false, reason:'MFA_NOT_ENROLLED' };
  if (row.status !== 'ACTIVE' && !(allowPending && row.status === 'PENDING')) {
    return { ok:false, reason:'MFA_NOT_ACTIVE' };
  }
  const normalized = String(code || '').replace(/\D/g, '').slice(0, 6);
  if (normalized.length !== 6) return { ok:false, reason:'MFA_CODE_INVALID' };
  let secret;
  try { secret = await decryptSecret(row, env); }
  catch { return { ok:false, reason:'MFA_SECRET_DECRYPT_FAILED' }; }
  const current = Math.floor(Date.now() / 30_000);
  for (let offset = -1; offset <= 1; offset += 1) {
    const candidate = await hotp(secret, current + offset);
    if (constantTimeEqual(candidate, normalized)) {
      await d1Run(database, `UPDATE app_user_mfa
        SET last_verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE user_id=?`, [userId]);
      return { ok:true, row };
    }
  }
  return { ok:false, reason:'MFA_CODE_INVALID' };
}

export async function activateUserMfa(database, env, userId, code) {
  const verified = await verifyUserMfa(database, env, userId, code, { allowPending:true });
  if (!verified.ok) return verified;
  await d1Run(database, `UPDATE app_user_mfa
    SET status='ACTIVE',
        activated_at=COALESCE(activated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE user_id=?`, [userId]);
  await d1Run(database, `UPDATE app_users SET mfa_required=1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, [userId]);
  return { ok:true };
}

export async function markCurrentSessionMfa(request, database) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return false;
  const tokenHash = await sha256Base64Url(token);
  const result = await d1Run(database, `UPDATE app_sessions
    SET mfa_verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE token_hash=? AND julianday(expires_at)>julianday('now')`, [tokenHash]);
  return Number(result?.meta?.changes || 0) === 1;
}
