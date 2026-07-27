import { neon } from '@neondatabase/serverless';
import { handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'GET, OPTIONS';

function getUrl(env) {
  return (
    env.DATABASE_URL ||
    env.NETLIFY_DB_URL ||
    env.NETLIFY_DATABASE_URL ||
    env.POSTGRES_URL ||
    env.NEON_DATABASE_URL ||
    null
  );
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env, METHODS);
  }
  if (request.method !== 'GET') {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }

  const requestId = crypto.randomUUID();
  try {
    const url = getUrl(env);
    if (!url) {
      return secureJson(
        { status: 'error', message: 'Service unavailable', requestId },
        503,
        request,
        env,
        METHODS
      );
    }

    const sql = neon(url);
    const rows = await sql`SELECT 1 AS ok, NOW() AS server_time`;
    return secureJson(
      {
        status: 'ok',
        ready: true,
        database: 'connected',
        server_time: rows[0]?.server_time,
        service: 'proqpay-lite',
        host: 'cloudflare-pages',
        auth_mode: String(env.AUTH_MODE || 'origin').toLowerCase() === 'access'
          ? 'access'
          : 'origin',
      },
      200,
      request,
      env,
      METHODS
    );
  } catch (error) {
    return secureJson(publicError(error, requestId), 500, request, env, METHODS);
  }
}
