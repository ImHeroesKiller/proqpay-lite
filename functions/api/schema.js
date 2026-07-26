import { neon } from '@neondatabase/serverless';

function getUrl(env) {
  return (
    env.DATABASE_URL ||
    env.NEON_DATABASE_URL ||
    env.POSTGRES_URL ||
    null
  );
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const url = getUrl(env);
    if (!url) {
      return json({ status: 'error', message: 'DATABASE_URL missing' }, 500);
    }

    const sql = neon(url);

    await sql`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        current_period TEXT DEFAULT '2025-07',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        name TEXT NOT NULL,
        npwp TEXT,
        pic TEXT,
        phone TEXT,
        payroll_type TEXT DEFAULT 'MONTHLY',
        status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        company TEXT,
        name TEXT NOT NULL,
        position TEXT,
        status TEXT DEFAULT 'TETAP',
        region TEXT,
        salary_gross BIGINT DEFAULT 0,
        bank_account TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS payrolls (
        id TEXT PRIMARY KEY,
        period TEXT NOT NULL,
        status TEXT DEFAULT 'DRAFT',
        total_gross BIGINT DEFAULT 0,
        total_deduction BIGINT DEFAULT 0,
        total_net BIGINT DEFAULT 0,
        employee_count INT DEFAULT 0,
        details JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        username TEXT,
        role TEXT,
        action TEXT,
        detail TEXT,
        entity TEXT,
        entity_id TEXT
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS ar_monitor (
        id TEXT PRIMARY KEY,
        company TEXT,
        invoice_id TEXT,
        amount BIGINT DEFAULT 0,
        status TEXT DEFAULT 'OUTSTANDING',
        days_overdue INT DEFAULT 0
      )
    `;

    return json({
      status: 'ok',
      message: 'Schema ready',
      host: 'cloudflare-pages',
      tables: ['organizations', 'companies', 'employees', 'payrolls', 'audit_logs', 'ar_monitor'],
    });
  } catch (err) {
    return json({ status: 'error', message: err?.message || String(err) }, 500);
  }
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}
