import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { hasD1 } from './_d1.js';
import { handleD1OperatingModel } from './operating-model-d1.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER'];

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }
  const authorization = await authorize(request, env, {
    roles: ROLES,
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'operating-model', METHODS);
  if (limited) return limited;
  if (!hasD1(env)) {
    return secureJson(
      { error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' },
      503,
      request,
      env,
      METHODS
    );
  }
  return handleD1OperatingModel(context, authorization.actor);
}
