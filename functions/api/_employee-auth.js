import {
  constantTimeEqual, passwordRecord, validatePassword, verifyPassword,
} from './_account-auth.js';
import { d1Batch, d1First, d1Run, hasD1 } from './_d1.js';

export const EMPLOYEE_SESSION_COOKIE = 'proqpay_employee';
export const DEFAULT_PASSWORD_SCHEME = 'PROJECT_JOIN_DATE';
export const ISSUE_BATCH_SIZE = 10;

const encoder = new TextEncoder();

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

export function projectSlug(code, name) {
  const source = String(code || name || 'PROJECT').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return (source || 'PROJECT').slice(0, 16);
}

export function uniqueJoinDate(joinDate, acceptedDate, createdAt) {
  const raw = String(joinDate || acceptedDate || createdAt || '');
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}${match[2]}${match[3]}`;
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

export function employeeIdSuffix(employeeCode, employeeId) {
  const source = String(employeeCode || employeeId || '').replace(/[^A-Za-z0-9]/g, '');
  return source.slice(-4).toUpperCase() || 'X';
}

export function assignDefaultPasswords(rows) {
  const prepared = (rows || []).map((row) => {
    const slug = projectSlug(row.project_code || row.projectCode, row.project_name || row.projectName);
    const date = uniqueJoinDate(row.join_date || row.joinDate, row.accepted_date || row.acceptedDate, row.created_at || row.createdAt);
    return { ...row, slug, date, base: `${slug}${date}` };
  });
  const counts = new Map();
  for (const row of prepared) counts.set(row.base, (counts.get(row.base) || 0) + 1);
  const seen = new Map();
  return prepared.map((row) => {
    let password = counts.get(row.base) > 1
      ? `${row.base}${employeeIdSuffix(row.employee_code || row.employeeCode, row.id)}`
      : row.base;
    const used = (seen.get(password) || 0) + 1;
    seen.set(password, used);
    if (used > 1) password = `${password}${used}`;
    return { ...row, password, scheme: DEFAULT_PASSWORD_SCHEME };
  });
}

export function isActiveEmployee(row) {
  const status = String(row?.status_aktif || row?.status || '').toLowerCase();
  if (!status) return true;
  return !/non|inaktif|inactive|resign|keluar|terminate/.test(status);
}

export function portalMutationAllowed(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin) {
    if (origin === url.origin) return true;
    const allowed = String(env.EMPLOYEE_PORTAL_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return allowed.includes(origin);
  }
  const portalKey = String(env.EMPLOYEE_PORTAL_KEY || '');
  const provided = request.headers.get('X-Portal-Key') || '';
  if (portalKey && provided && constantTimeEqual(portalKey, provided)) return true;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

/** Origins allowed to call /api/employee/* — never APP_ORIGINS / ops Access. */
export function employeeAllowedOrigins(request, env) {
  const currentOrigin = new URL(request.url).origin;
  const configured = String(env.EMPLOYEE_PORTAL_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([currentOrigin, ...configured]);
}

export function employeeCorsHeaders(request, env, methods = 'GET, POST, OPTIONS') {
  const origin = request.headers.get('Origin');
  const allowed = employeeAllowedOrigins(request, env);
  const responseOrigin = origin && allowed.has(origin) ? origin : new URL(request.url).origin;
  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Portal-Key',
    'Access-Control-Allow-Methods': methods,
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
}

export function employeeJson(data, status, request, env, methods, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...employeeCorsHeaders(request, env, methods),
      ...extraHeaders,
    },
  });
}

export function employeeHandlePreflight(request, env, methods) {
  const origin = request.headers.get('Origin');
  if (origin && !employeeAllowedOrigins(request, env).has(origin)) {
    return employeeJson({ error: 'Origin not allowed' }, 403, request, env, methods);
  }
  return new Response(null, {
    status: 204,
    headers: employeeCorsHeaders(request, env, methods),
  });
}

export function employeeSessionCookie(token, hours) {
  const maxAge = Math.max(1, hours) * 3600;
  return `${EMPLOYEE_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearEmployeeSessionCookie() {
  return `${EMPLOYEE_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function cookieValue(request, name) {
  const cookies = String(request.headers.get('Cookie') || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

export function employeeTokenFromRequest(request) {
  const cookie = cookieValue(request, EMPLOYEE_SESSION_COOKIE);
  if (cookie) return cookie;
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export async function createEmployeeSession(database, employeeId, env) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const hours = Math.min(Math.max(Number(env.EMPLOYEE_SESSION_HOURS || 12), 1), 168);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  await d1Batch(database, [
    { statement: "DELETE FROM employee_portal_sessions WHERE julianday(expires_at) <= julianday('now')" },
    {
      statement: 'INSERT INTO employee_portal_sessions (token_hash, employee_id, expires_at) VALUES (?, ?, ?)',
      bindings: [tokenHash, employeeId, expiresAt],
    },
  ]);
  return { token, cookie: employeeSessionCookie(token, hours), hours };
}

export async function revokeEmployeeSession(request, database) {
  const token = employeeTokenFromRequest(request);
  if (token) await d1Run(database, 'DELETE FROM employee_portal_sessions WHERE token_hash=?', [await sha256(token)]);
}

export async function authenticateEmployee(request, env) {
  // Employee session only. Ignore Cf-Access-Jwt-Assertion — that is ops Access.
  if (!hasD1(env)) return null;
  const token = employeeTokenFromRequest(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  await d1Run(
    env.DB,
    `UPDATE employee_portal_sessions
      SET last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE token_hash=? AND julianday(expires_at)>julianday('now')`,
    [tokenHash],
  );
  const row = await d1First(
    env.DB,
    `SELECT e.id, e.employee_code, e.name, e.email, e.client_id, e.project_id, e.org_id, e.status_aktif,
        c.must_change_password
      FROM employee_portal_sessions s
      JOIN employees e ON e.id=s.employee_id
      JOIN employee_credentials c ON c.employee_id=e.id
      WHERE s.token_hash=? AND julianday(s.expires_at)>julianday('now')
      LIMIT 1`,
    [tokenHash],
  );
  if (!row || !isActiveEmployee(row)) return null;
  return {
    id: row.id,
    employeeCode: row.employee_code || row.id,
    name: row.name,
    email: row.email,
    clientId: row.client_id,
    projectId: row.project_id,
    orgId: row.org_id,
    role: 'EMPLOYEE',
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function findEmployeeForLogin(database, empId, orgId) {
  const id = String(empId || '').trim();
  if (!id) return null;
  return d1First(
    database,
    `SELECT e.id, e.employee_code, e.name, e.email, e.client_id, e.project_id, e.org_id, e.status_aktif
      FROM employees e
      WHERE e.org_id=? AND (e.id=? OR e.employee_code=?)
      LIMIT 1`,
    [orgId, id, id],
  );
}

export async function countRecentFailures(database, ip, empInput) {
  const row = await d1First(
    database,
    `SELECT COUNT(*) AS count FROM portal_login_attempts
      WHERE success=0
        AND julianday(created_at) > julianday('now', '-10 minutes')
        AND (ip=? OR lower(employee_id_input)=lower(?))`,
    [ip || 'unknown', empInput || ''],
  );
  return Number(row?.count || 0);
}

export async function recordLoginAttempt(database, {
  employeeIdInput, employeeId, ip, success, reason,
}) {
  await d1Run(
    database,
    `INSERT INTO portal_login_attempts (id, employee_id_input, employee_id, ip, success, reason)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [`ATT-${crypto.randomUUID()}`, employeeIdInput || null, employeeId || null, ip || 'unknown', success ? 1 : 0, reason || null],
  );
}

const DUMMY_CREDENTIALS = {
  password_hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  password_salt: 'dummy-employee-salt',
  password_iterations: 100000,
};

export async function verifyEmployeeSecret(password, credentials) {
  return verifyPassword(password, credentials || DUMMY_CREDENTIALS);
}

export { passwordRecord, validatePassword, verifyPassword };
