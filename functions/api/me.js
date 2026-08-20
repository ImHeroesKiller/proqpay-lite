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
  const effectiveAuthMode = actor.authSource || String(env.AUTH_MODE || 'origin').toLowerCase();
  return secureJson(
    {
      authenticated: ['access', 'database', 'session', 'd1'].includes(effectiveAuthMode),
      authMode: effectiveAuthMode,
      user: {
        id: actor.id,
        name: actor.name || String(actor.email || '').split('@')[0],
        email: actor.email,
        role: actor.role,
        permissions: actor.permissions || permissionsFor(actor.role, actor.email, env),
        mustChangePassword: Boolean(actor.mustChangePassword),
        clientIds: actor.role === 'CLIENT_USER' ? (actor.clientIds || []) : null,
        projectIds: actor.role === 'CLIENT_USER' ? (actor.projectIds || []) : null,
      },
    },
    200,
    request,
    env,
    METHODS
  );
}
