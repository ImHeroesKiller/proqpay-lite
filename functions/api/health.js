import { neon } from '@neondatabase/serverless';

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

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  const envHints = {
    DATABASE_URL: Boolean(env.DATABASE_URL),
    NEON_DATABASE_URL: Boolean(env.NEON_DATABASE_URL),
    POSTGRES_URL: Boolean(env.POSTGRES_URL),
  };

  try {
    const url = getUrl(env);
    if (!url) {
      return json(
        {
          status: 'error',
          database: 'disconnected',
          message: 'Set DATABASE_URL in Cloudflare Pages → Settings → Environment variables',
          env_present: envHints,
          host: 'cloudflare-pages',
        },
        500
      );
    }

    const sql = neon(url);
    const rows = await sql`SELECT 1 AS ok, NOW() AS server_time`;

    return json({
      status: 'ok',
      database: 'connected',
      server_time: rows[0]?.server_time,
      env_present: envHints,
      service: 'proqpay-lite',
      host: 'cloudflare-pages',
    });
  } catch (err) {
    return json(
      {
        status: 'error',
        database: 'disconnected',
        message: err?.message || String(err),
        env_present: envHints,
        host: 'cloudflare-pages',
      },
      500
    );
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}
