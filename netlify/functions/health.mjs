import { getSql, json, handleOptions } from './db.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();

  try {
    const sql = getSql();
    const rows = await sql`SELECT 1 AS ok, NOW() AS server_time`;
    return json({
      status: 'ok',
      database: 'connected',
      server_time: rows[0]?.server_time,
      service: 'proqpay-lite',
    });
  } catch (err) {
    return json(
      {
        status: 'error',
        database: 'disconnected',
        message: err?.message || String(err),
      },
      500
    );
  }
};

export const config = { path: '/api/health' };
