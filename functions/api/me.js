import {
  ROLES,
  authorize,
  handlePreflight,
  permissionsFor,
  secureJson,
} from './_security.js';

const METHODS = 'GET, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env, METHODS);
  }
  if (request.method !== 'GET') {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: ROLES,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;

  const actor = authorization.actor;
  return secureJson(
    {
      authenticated: ['access', 'database', 'session'].includes(String(env.AUTH_MODE || 'origin').toLowerCase()),
      authMode: String(env.AUTH_MODE || 'origin').toLowerCase(),
      user: {
        id: actor.id,
        name: actor.name || String(actor.email || '').split('@')[0],
        email: actor.email,
        role: actor.role,
        permissions: actor.permissions || permissionsFor(actor.role, actor.email, env),
        mustChangePassword: Boolean(actor.mustChangePassword),
        clientIds: actor.role === 'CLIENT_USER' ? (actor.clientIds || []) : null,
      },
    },
    200,
    request,
    env,
    METHODS
  );
}
