/**
 * Shared DB helper for Netlify Functions
 * Set one of these in Netlify → Environment variables:
 *   DATABASE_URL  (recommended)
 *   NETLIFY_DATABASE_URL
 *   POSTGRES_URL
 *
 * Works with Neon / any Postgres connection string.
 */

import { neon } from '@neondatabase/serverless';

export function getSql() {
  const url =
    process.env.DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL;

  if (!url) {
    throw new Error(
      'Missing DATABASE_URL. Add it in Netlify → Site settings → Environment variables.'
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
