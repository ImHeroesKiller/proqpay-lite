import { d1Batch, d1First, d1Run, hasD1 } from './_d1.js';
import { APP_ROLES } from '../../shared/authority-matrix.js';
import { recordFraudIncident } from './_fraud-incidents.js';
import { isCriticalMfaRole, requestSecurityContext } from './_security-context.js';

export const SESSION_COOKIE = 'proqpay_session';
export const ACCOUNT_ROLES = APP_ROLES;

const encoder = new TextEncoder();
// Keep the KDF inside Cloudflare Pages' CPU budget. Generated passwords carry
// high entropy, while lockout and mandatory first-login rotation limit guessing.
const PASSWORD_ITERATIONS = 100_000;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations },
    key,
    256
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] || 0) ^ (b[index] || 0);
  }
  return mismatch === 0;
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12) return 'Password minimal 12 karakter';
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return 'Password wajib memiliki huruf besar, huruf kecil, angka, dan simbol';
  }
  return null;
}

export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `Pq!${random}7a`;
}

export async function passwordRecord(password) {
  const salt = randomToken(18);
  return {
    hash: await derivePassword(password, salt, PASSWORD_ITERATIONS),
    salt,
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(password, user) {
  const candidate = await derivePassword(password, user.password_salt, Number(user.password_iterations));
  return constantTimeEqual(candidate, user.password_hash);
}

function cookieValue(request, name) {
  const cookies = String(request.headers.get('Cookie') || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

export async function createSession(database, userId, env, options = {}) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const hours = Math.min(Math.max(Number(env.SESSION_HOURS || 8), 1), 168);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await d1Batch(database, [
    { statement: "DELETE FROM app_sessions WHERE julianday(expires_at) <= julianday('now')" },
    {
      statement: `INSERT INTO app_sessions
        (token_hash,user_id,expires_at,mfa_verified_at,ip_hash,device_hash,current_ip_hash,current_device_hash,auth_strength,passkey_verified_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      bindings: [
        tokenHash,
        userId,
        expiresAt.toISOString(),
        options.mfaVerifiedAt || null,
        options.context?.ipHash || null,
        options.context?.deviceHash || null,
        options.context?.ipHash || null,
        options.context?.deviceHash || null,
        options.authStrength || (options.mfaVerifiedAt ? 'PASSWORD_TOTP' : 'PASSWORD'),
        options.passkeyVerifiedAt || null,
      ],
    },
  ]);
  return {
    token,
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${hours * 3600}`,
  };
}

export async function revokeSession(request, database) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await d1Run(database, 'DELETE FROM app_sessions WHERE token_hash=?', [await sha256(token)]);
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function authenticateSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!hasD1(env) || !token) return null;
  const tokenHash = await sha256(token);
  const results = await d1Batch(env.DB, [
    {
      statement: `UPDATE app_sessions
        SET last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE token_hash=? AND julianday(expires_at)>julianday('now')`,
      bindings: [tokenHash],
    },
    {
      statement: `SELECT u.id, u.org_id, u.name, u.email, u.role, u.status, u.must_change_password,
          u.payment_approver, s.expires_at, s.mfa_verified_at, s.ip_hash, s.device_hash,
          s.current_ip_hash, s.current_device_hash, s.anomaly_count, s.last_anomaly_at,
          s.auth_strength, s.passkey_verified_at,
          (SELECT json_group_array(client_id) FROM user_client_scopes WHERE user_id=u.id) AS client_ids,
          (SELECT json_group_array(project_id) FROM user_project_scopes WHERE user_id=u.id) AS project_ids
        FROM app_sessions s JOIN app_users u ON u.id=s.user_id
        WHERE s.token_hash=? AND julianday(s.expires_at)>julianday('now') AND u.status='ACTIVE'
        LIMIT 1`,
      bindings: [tokenHash],
    },
  ]);
  const user = results[1]?.results?.[0];
  if (!user) return null;

  const context = await requestSecurityContext(request, env).catch(() => ({ ipHash:null, deviceHash:null }));
  const previousIpHash = user.current_ip_hash || user.ip_hash || null;
  const previousDeviceHash = user.current_device_hash || user.device_hash || null;
  const ipChanged = Boolean(previousIpHash && context.ipHash && previousIpHash !== context.ipHash);
  const deviceChanged = Boolean(previousDeviceHash && context.deviceHash && previousDeviceHash !== context.deviceHash);

  if (ipChanged || deviceChanged) {
    const privileged = isCriticalMfaRole(user.role);
    const severity = deviceChanged ? (privileged ? 'HIGH' : 'MEDIUM') : (privileged ? 'MEDIUM' : 'LOW');
    await recordFraudIncident(env.DB, {
      orgId:String(user.org_id || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'),
      source:'SESSION',
      ruleCode:deviceChanged ? 'SESSION_DEVICE_FINGERPRINT_CHANGED' : 'SESSION_NETWORK_CHANGED',
      severity,
      entity:'app_session',
      entityId:tokenHash,
      actorUserId:user.id,
      actorIpHash:context.ipHash,
      actorDeviceHash:context.deviceHash,
      summary:deviceChanged
        ? 'Authenticated session device fingerprint changed'
        : 'Authenticated session network fingerprint changed',
      metadata:{
        role:user.role,
        ipChanged,
        deviceChanged,
        anomalyCount:Number(user.anomaly_count || 0) + 1,
      },
    }).catch(() => null);

    const deviceMode=String(env.SECURITY_SESSION_DEVICE_MODE || 'ENFORCE_CRITICAL').trim().toUpperCase();
    if (deviceChanged && privileged && deviceMode !== 'AUDIT') {
      await d1Run(env.DB,'DELETE FROM app_sessions WHERE token_hash=?',[tokenHash]);
      return null;
    }

    await d1Run(env.DB,`UPDATE app_sessions SET
      current_ip_hash=COALESCE(?,current_ip_hash,ip_hash),
      current_device_hash=COALESCE(?,current_device_hash,device_hash),
      anomaly_count=anomaly_count+1,
      last_anomaly_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE token_hash=?`,[context.ipHash || null,context.deviceHash || null,tokenHash]);
  }

  const parseIds = (value) => {
    try { return Array.isArray(value) ? value : JSON.parse(value || '[]'); } catch { return []; }
  };
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    orgId: user.org_id || null,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
    paymentApprover: Boolean(user.payment_approver),
    mfaVerifiedAt: user.mfa_verified_at || null,
    passkeyVerifiedAt: user.passkey_verified_at || null,
    authStrength: user.auth_strength || 'PASSWORD',
    sessionIpHash: user.ip_hash || null,
    sessionDeviceHash: user.device_hash || null,
    clientIds: parseIds(user.client_ids),
    projectIds: parseIds(user.project_ids),
    authSource: 'd1',
  };
}

export async function markCurrentSessionAuthStrength(request, database, strength, verifiedAt = new Date().toISOString()) {
  const allowed=new Set(['PASSWORD','PASSWORD_TOTP','PASSKEY_UV']);
  const normalized=String(strength || '').toUpperCase();
  if(!allowed.has(normalized)) return false;
  const token=cookieValue(request,SESSION_COOKIE);
  if(!token) return false;
  const tokenHash=await sha256(token);
  const result=await d1Run(database,`UPDATE app_sessions SET
    auth_strength=?,
    passkey_verified_at=CASE WHEN ?='PASSKEY_UV' THEN ? ELSE passkey_verified_at END,
    mfa_verified_at=CASE WHEN ?='PASSKEY_UV' THEN COALESCE(mfa_verified_at,?) ELSE mfa_verified_at END,
    last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE token_hash=? AND julianday(expires_at)>julianday('now')`,[
      normalized,normalized,verifiedAt,normalized,verifiedAt,tokenHash,
    ]);
  return Number(result?.meta?.changes || 0) === 1;
}

export async function hasActiveAccounts(env) {
  if (!hasD1(env)) return false;
  const row = await d1First(env.DB, "SELECT 1 AS configured FROM app_users WHERE status='ACTIVE' LIMIT 1");
  return Boolean(row?.configured);
}
