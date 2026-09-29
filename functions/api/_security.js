import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ACCOUNT_ROLES, authenticateSession, hasActiveAccounts } from './_account-auth.js';
import { permissionsForRole } from '../../shared/authority-matrix.js';
import { isCriticalMfaRole, protectedHash, requestSecurityContext, sha256Hex } from './_security-context.js';
import { hasActivePasskey, passkeyEnforcementMode } from './_webauthn.js';

export const ROLES = ACCOUNT_ROLES;

function mappedIdentity(email, env = {}) {
  const entry = parseRoleMap(env)[String(email || '').trim().toLowerCase()];
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    return {
      role: String(entry.role || 'UNASSIGNED').toUpperCase(),
      permissions: Array.isArray(entry.permissions) ? entry.permissions.map(String) : [],
    };
  }
  return { role: String(entry || 'UNASSIGNED').toUpperCase(), permissions: [] };
}

export function permissionsFor(role, email = '', env = {}) {
  const base = permissionsForRole(role);
  const grants = mappedIdentity(email, env).permissions;
  const paymentApprover = grants.includes('PAYMENT_APPROVER') || grants.includes('payment:approve');
  return [...new Set([
    ...base,
    ...(paymentApprover ? ['PAYMENT_APPROVER', 'payment:approve'] : []),
  ])];
}

function configuredOrigins(request, env) {
  const currentOrigin = new URL(request.url).origin;
  const configured = String(env.APP_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([currentOrigin, ...configured]);
}

export function corsHeaders(request, env, methods = 'GET, OPTIONS') {
  const origin = request.headers.get('Origin');
  const allowed = configuredOrigins(request, env);
  const responseOrigin = origin && allowed.has(origin) ? origin : new URL(request.url).origin;
  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cf-Access-Jwt-Assertion, X-ProQPay-App-Id, X-ProQPay-App-Name, X-Request-Id, X-Correlation-Id',
    'Access-Control-Allow-Methods': methods,
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
}

export function handlePreflight(request, env, methods) {
  const origin = request.headers.get('Origin');
  if (origin && !configuredOrigins(request, env).has(origin)) {
    return secureJson(
      { error: 'Origin not allowed' },
      403,
      request,
      env,
      methods
    );
  }
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env, methods),
  });
}

export function secureJson(data, status, request, env, methods, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env, methods),
      ...extraHeaders,
    },
  });
}

function sameOriginMutation(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (origin) return origin === url.origin;
  return fetchSite === 'same-origin';
}

function parseRoleMap(env) {
  if (!env.ROLE_MAP_JSON) return {};
  try {
    const parsed = JSON.parse(env.ROLE_MAP_JSON);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([email, role]) => [
        String(email).trim().toLowerCase(),
        role,
      ])
    );
  } catch {
    return {};
  }
}

function roleFor(email, env) {
  const mapped = mappedIdentity(email, env).role;
  return ROLES.includes(mapped) ? mapped : 'UNASSIGNED';
}

export function clientIdsFor(actor, env) {
  if (actor?.role !== 'CLIENT_USER') return null;
  if (Array.isArray(actor.clientIds)) return actor.clientIds.map(String);
  try {
    const map = JSON.parse(env.CLIENT_SCOPE_JSON || '{}');
    const value = map[String(actor.email || '').toLowerCase()];
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export function projectIdsFor(actor) {
  if (actor?.role !== 'CLIENT_USER') return null;
  return Array.isArray(actor.projectIds) ? actor.projectIds.map(String) : [];
}

async function verifyAccess(request, env) {
  const teamDomain = String(env.CF_ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, '');
  const audience = String(env.CF_ACCESS_AUD || '');
  if (!teamDomain || !audience) {
    throw new Error('Cloudflare Access environment is incomplete');
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new Error('Cloudflare Access token missing');

  const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, {
    issuer: teamDomain,
    audience,
  });
  const email = String(payload.email || '').toLowerCase();
  if (!email) throw new Error('Authenticated email missing');

  return {
    id: String(payload.sub || email),
    email,
    role: roleFor(email, env),
  };
}

export async function authorize(
  request,
  env,
  {
    roles = ROLES,
    mutating = false,
    methods = 'GET, OPTIONS',
    allowPasskeyEnrollment = false,
  } = {}
) {
  const mode = String(env.AUTH_MODE || 'origin').toLowerCase();
  let actor;

  if (mode === 'access') {
    try {
      actor = await verifyAccess(request, env);
      actor.authSource = 'access';
    } catch {
      return {
        response: secureJson(
          { error: 'Authentication required' },
          401,
          request,
          env,
          methods
        ),
      };
    }
  } else if (mode === 'database' || mode === 'session') {
    actor = await authenticateSession(request, env);
    if (!actor) {
      return {
        response: secureJson(
          { error: 'Authentication required' },
          401,
          request,
          env,
          methods
        ),
      };
    }
    if (mutating && !sameOriginMutation(request)) {
      return {
        response: secureJson({ error: 'Same-origin request required' }, 403, request, env, methods),
      };
    }
  } else {
    try {
      const databaseActor = await authenticateSession(request, env);
      if (databaseActor) {
        actor = databaseActor;
      } else if (await hasActiveAccounts(env)) {
        return {
          response: secureJson(
            { error: 'Authentication required' }, 401, request, env, methods
          ),
        };
      }
    } catch {
      return {
        response: secureJson(
          { error: 'Authentication service unavailable' }, 503, request, env, methods
        ),
      };
    }
    if (mutating && !sameOriginMutation(request)) {
      return {
        response: secureJson(
          { error: 'Same-origin request required' },
          403,
          request,
          env,
          methods
        ),
      };
    }
    if (!actor) actor = { id: 'origin-session', email: 'local@proqpay', role: 'SUPER_ADMIN', authSource: 'origin' };
  }

  if (!roles.includes(actor.role)) {
    return {
      response: secureJson(
        { error: 'Insufficient role' },
        403,
        request,
        env,
        methods
      ),
    };
  }
  actor.orgId = actor.orgId || String(env.DEFAULT_ORG_ID || '') || null;

  if (
    passkeyEnforcementMode(env) === 'ENFORCE'
    && actor.authSource === 'd1'
    && isCriticalMfaRole(actor.role)
    && env.DB?.prepare
  ) {
    const configured = await hasActivePasskey(env.DB, actor.id);
    if (!configured && !allowPasskeyEnrollment) {
      return {
        response: secureJson({
          error:'Passkey wajib didaftarkan untuk role privileged ini.',
          code:'PASSKEY_ENROLLMENT_REQUIRED',
          passkeyRequired:true,
        },428,request,env,methods),
      };
    }
    if (configured && actor.authStrength !== 'PASSKEY_UV' && !allowPasskeyEnrollment) {
      return {
        response: secureJson({
          error:'Autentikasi ulang menggunakan passkey diperlukan.',
          code:'PASSKEY_REAUTH_REQUIRED',
          passkeyRequired:true,
        },428,request,env,methods),
      };
    }
  }

  actor.permissions = permissionsFor(actor.role, actor.email, env);
  if (actor.paymentApprover) {
    actor.permissions = [...new Set([...actor.permissions, 'PAYMENT_APPROVER', 'payment:approve'])];
  }
  const securityContext = await requestSecurityContext(request, env).catch(() => ({ ipHash:null, deviceHash:null }));
  actor.requestIpHash = securityContext.ipHash || null;
  actor.requestDeviceHash = securityContext.deviceHash || null;
  return { actor };
}

function rateLimitPerMinute(resource, env = {}) {
  const configured = Number(env.API_RATE_LIMIT_PER_MINUTE || 0);
  if (Number.isFinite(configured) && configured > 0) return Math.min(Math.max(Math.trunc(configured), 5), 5000);
  if (resource === 'account-login') return 10;
  if (String(resource || '').startsWith('security-')) return 60;
  if (resource === 'audit-logs') return 120;
  return 180;
}

export async function enforceRateLimit(request, env, actor, resource, methods) {
  const stableActor =
    actor?.id ||
    actor?.email ||
    request.headers.get('Cf-Connecting-Ip') ||
    'anonymous';

  if (env.API_RATE_LIMITER?.limit) {
    const { success } = await env.API_RATE_LIMITER.limit({
      key: `${stableActor}:${resource}`,
    });
    if (success) return null;
    return secureJson(
      { error: 'Too many requests' },
      429,
      request,
      env,
      methods,
      { 'Retry-After': '60' }
    );
  }

  if (!env.DB?.prepare || String(env.SECURITY_D1_RATE_LIMIT_FALLBACK || 'ENFORCE').toUpperCase() === 'OFF') {
    return null;
  }

  const rawKey = `${stableActor}:${resource}`;
  const rateKey = await protectedHash(rawKey, env, 'RATE_LIMIT') || await sha256Hex(rawKey);
  const windowEpoch = Math.floor(Date.now() / 60_000);
  const limit = rateLimitPerMinute(resource, env);

  await env.DB.prepare(`INSERT INTO security_rate_limits(rate_key,window_epoch,request_count,updated_at)
    VALUES(?,?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(rate_key,window_epoch) DO UPDATE SET
      request_count=request_count+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .bind(rateKey,windowEpoch).run();

  const row = await env.DB.prepare(
    'SELECT request_count FROM security_rate_limits WHERE rate_key=? AND window_epoch=?'
  ).bind(rateKey,windowEpoch).first();

  if (Number(row?.request_count || 0) === 1) {
    await env.DB.prepare('DELETE FROM security_rate_limits WHERE window_epoch<?')
      .bind(windowEpoch - 1440).run().catch(() => null);
  }

  if (Number(row?.request_count || 0) <= limit) return null;
  return secureJson(
    { error: 'Too many requests' },
    429,
    request,
    env,
    methods,
    { 'Retry-After': '60' }
  );
}

export function publicError(error, requestId) {
  console.error(
    JSON.stringify({
      level: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  );
  return { status: 'error', message: 'Internal server error', requestId };
}
