import { createRemoteJWKSet, jwtVerify } from 'jose';

export const ROLES = Object.freeze([
  'SUPER_ADMIN',
  'PAYROLL',
  'HR',
  'FINANCE',
  'DIRECTOR',
  'VIEWER',
]);

const ROLE_PERMISSIONS = Object.freeze({
  SUPER_ADMIN: ['read', 'employees:write', 'import:write', 'schema:write', 'settings:write'],
  PAYROLL: ['read', 'employees:write', 'import:write', 'payroll:write'],
  HR: ['read', 'employees:write', 'import:write'],
  FINANCE: ['read', 'finance:write'],
  DIRECTOR: ['read', 'approval:write'],
  VIEWER: ['read'],
});

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.VIEWER;
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
    'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
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
  return origin === url.origin || fetchSite === 'same-origin';
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
  const mapped = String(parseRoleMap(env)[email] || 'VIEWER').toUpperCase();
  return ROLES.includes(mapped) ? mapped : 'VIEWER';
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
  } = {}
) {
  const mode = String(env.AUTH_MODE || 'origin').toLowerCase();
  let actor;

  if (mode === 'access') {
    try {
      actor = await verifyAccess(request, env);
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
  } else {
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
    actor = { id: 'origin-session', email: 'local@proqpay', role: 'SUPER_ADMIN' };
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
  return { actor };
}

export async function enforceRateLimit(request, env, actor, resource, methods) {
  if (!env.API_RATE_LIMITER?.limit) return null;
  const stableActor =
    actor?.id ||
    actor?.email ||
    request.headers.get('Cf-Connecting-Ip') ||
    'anonymous';
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
