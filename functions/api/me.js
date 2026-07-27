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
      authenticated: String(env.AUTH_MODE || 'origin').toLowerCase() === 'access',
      user: {
        id: actor.id,
        email: actor.email,
        role: actor.role,
        permissions: permissionsFor(actor.role),
      },
    },
    200,
    request,
    env,
    METHODS
  );
}
