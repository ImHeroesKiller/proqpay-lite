import { d1Batch, d1First, d1Run, hasD1 } from './_d1.js';

export const SESSION_COOKIE = 'proqpay_session';
export const ACCOUNT_ROLES = Object.freeze([
  'SUPER_ADMIN',
  'PAYROLL_PROCESSOR',
  'PAYROLL_CONTROLLER',
  'CLIENT_USER',
]);

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

export async function createSession(database, userId, env) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const hours = Math.min(Math.max(Number(env.SESSION_HOURS || 8), 1), 168);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await d1Batch(database, [
    { statement: "DELETE FROM app_sessions WHERE julianday(expires_at) <= julianday('now')" },
    {
      statement: 'INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      bindings: [tokenHash, userId, expiresAt.toISOString()],
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
      statement: `SELECT u.id, u.name, u.email, u.role, u.status, u.must_change_password,
          u.payment_approver, s.expires_at,
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
  const parseIds = (value) => {
    try { return Array.isArray(value) ? value : JSON.parse(value || '[]'); } catch { return []; }
  };
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
    paymentApprover: Boolean(user.payment_approver),
    clientIds: parseIds(user.client_ids),
    projectIds: parseIds(user.project_ids),
    authSource: 'd1',
  };
}

export async function hasActiveAccounts(env) {
  if (!hasD1(env)) return false;
  const row = await d1First(env.DB, "SELECT 1 AS configured FROM app_users WHERE status='ACTIVE' LIMIT 1");
  return Boolean(row?.configured);
}
