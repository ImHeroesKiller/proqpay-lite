import { neon } from '@neondatabase/serverless';

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

export function databaseUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

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

function constantTimeEqual(left, right) {
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

export async function ensureAccountSchema(sql) {
  await sql.query(`CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INT NOT NULL DEFAULT 100000,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    payment_approver BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT NOT NULL,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_lower ON app_users (LOWER(email))`);
  await sql.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0`);
  await sql.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`);
  await sql.query(`CREATE TABLE IF NOT EXISTS user_client_scopes (
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, client_id)
  )`);
  await sql.query(`CREATE TABLE IF NOT EXISTS user_project_scopes (
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, project_id)
  )`);
  await sql.query(`CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_app_sessions_expiry ON app_sessions(expires_at)`);
}

function cookieValue(request, name) {
  const cookies = String(request.headers.get('Cookie') || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

export async function createSession(sql, userId, env) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const hours = Math.min(Math.max(Number(env.SESSION_HOURS || 8), 1), 168);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await sql`DELETE FROM app_sessions WHERE expires_at <= NOW()`;
  await sql`INSERT INTO app_sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, ${expiresAt.toISOString()})`;
  return {
    token,
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${hours * 3600}`,
  };
}

export async function revokeSession(request, sql) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await sql`DELETE FROM app_sessions WHERE token_hash=${await sha256(token)}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function authenticateSession(request, env) {
  const url = databaseUrl(env);
  const token = cookieValue(request, SESSION_COOKIE);
  if (!url || !token) return null;
  const sql = neon(url);
  await sql.query(`CREATE TABLE IF NOT EXISTS user_project_scopes (
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, project_id)
  )`);
  const tokenHash = await sha256(token);
  const rows = await sql`
    SELECT u.id, u.name, u.email, u.role, u.status, u.must_change_password,
      u.payment_approver, s.expires_at,
      COALESCE((SELECT array_agg(ucs.client_id) FROM user_client_scopes ucs WHERE ucs.user_id=u.id), ARRAY[]::text[]) AS client_ids,
      COALESCE((SELECT array_agg(ups.project_id) FROM user_project_scopes ups WHERE ups.user_id=u.id), ARRAY[]::text[]) AS project_ids
    FROM app_sessions s
    JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=${tokenHash} AND s.expires_at>NOW() AND u.status='ACTIVE'
    GROUP BY u.id, s.expires_at
    LIMIT 1`;
  if (!rows.length) return null;
  await sql`UPDATE app_sessions SET last_seen_at=NOW() WHERE token_hash=${tokenHash}`;
  const user = rows[0];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
    paymentApprover: Boolean(user.payment_approver),
    clientIds: user.client_ids || [],
    projectIds: user.project_ids || [],
    authSource: 'database',
  };
}

export async function hasActiveAccounts(env) {
  const url = databaseUrl(env);
  if (!url) return false;
  const sql = neon(url);
  const rows = await sql`SELECT EXISTS(
    SELECT 1 FROM app_users WHERE status='ACTIVE'
  ) AS configured`;
  return Boolean(rows[0]?.configured);
}
