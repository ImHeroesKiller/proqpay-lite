import { getSql, getConnectionUrl, json, handleOptions } from './db.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();

  const envHints = {
    NETLIFY_DB_URL: Boolean(process.env.NETLIFY_DB_URL),
    NETLIFY_DATABASE_URL: Boolean(process.env.NETLIFY_DATABASE_URL),
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
    NEON_DATABASE_URL: Boolean(process.env.NEON_DATABASE_URL),
  };

  const hasAny = Object.values(envHints).some(Boolean);

  try {
    const url = getConnectionUrl();
    if (!url) {
      return json(
        {
          status: 'error',
          database: 'disconnected',
          message: hasAny
            ? 'Env flag present but getConnectionUrl() returned empty — check secret scope includes Functions and redeploy.'
            : 'No DATABASE_URL in Function runtime. Set env, scope to Functions, then Trigger deploy.',
          env_present: envHints,
        },
        500
      );
    }

    const sql = getSql();
    const rows = await sql`SELECT 1 AS ok, NOW() AS server_time`;
    return json({
      status: 'ok',
      database: 'connected',
      server_time: rows[0]?.server_time,
      env_present: envHints,
      service: 'proqpay-lite',
    });
  } catch (err) {
    return json(
      {
        status: 'error',
        database: 'disconnected',
        message: err?.message || String(err),
        env_present: envHints,
      },
      500
    );
  }
};

export const config = {
  path: '/api/health',
};
