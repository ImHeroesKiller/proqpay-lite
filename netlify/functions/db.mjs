/**
 * Shared DB helper for Netlify Functions
 *
 * Netlify Database (native):
 *   - Runtime injects NETLIFY_DB_URL (often NOT visible in Env UI)
 *   - Or use getConnectionString() from @netlify/database
 *
 * Fallback env names:
 *   DATABASE_URL, NETLIFY_DATABASE_URL, POSTGRES_URL, NEON_DATABASE_URL
 */

import { neon } from '@neondatabase/serverless';

export function getConnectionUrl() {
  // 1) Prefer official Netlify Database helper if available
  try {
    // Dynamic import may not work in all runtimes; try require-style via process.env first
    const fromEnv =
      process.env.NETLIFY_DB_URL ||
      process.env.NETLIFY_DATABASE_URL ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.NEON_DATABASE_URL;

    if (fromEnv) return fromEnv;
  } catch {
    /* ignore */
  }

  // 2) Try @netlify/database getConnectionString (native Netlify DB)
  try {
    // eslint-disable-next-line import/no-unresolved
    const { getConnectionString } = require('@netlify/database');
    const cs = getConnectionString();
    if (cs) return cs;
  } catch {
    /* package optional */
  }

  return null;
}

export function getSql() {
  const url = getConnectionUrl();

  if (!url) {
    throw new Error(
      'No database URL found. For Netlify Database native, ensure the site Database is active and Functions can read NETLIFY_DB_URL. Or set DATABASE_URL manually.'
    );
  }

  return neon(url);
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
  });
}

export function handleOptions() {
  return json({ ok: true }, 204);
}
