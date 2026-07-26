import { neon } from '@neondatabase/serverless';

function getUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  try {
    const url = getUrl(env);
    if (!url) return json({ status: 'error', message: 'DATABASE_URL missing' }, 500);

    const sql = neon(url);

    if (request.method === 'GET') {
      const rows = await sql`
        SELECT id, company, name, position, status, region,
               salary_gross AS "salaryGross", bank_account AS "bankAccount"
        FROM employees
        ORDER BY name ASC
        LIMIT 500
      `;
      return json({ employees: rows, count: rows.length });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const id = body.id || `EMP${Date.now()}`;
      await sql`
        INSERT INTO employees (id, company, name, position, status, region, salary_gross, bank_account)
        VALUES (
          ${id},
          ${body.company || null},
          ${body.name},
          ${body.position || null},
          ${body.status || 'TETAP'},
          ${body.region || null},
          ${body.salaryGross || body.salary_gross || 0},
          ${body.bankAccount || body.bank_account || null}
        )
        ON CONFLICT (id) DO UPDATE SET
          company = EXCLUDED.company,
          name = EXCLUDED.name,
          position = EXCLUDED.position,
          status = EXCLUDED.status,
          region = EXCLUDED.region,
          salary_gross = EXCLUDED.salary_gross,
          bank_account = EXCLUDED.bank_account
      `;
      return json({ ok: true, id });
    }

    return json({ error: 'Method not allowed' }, 405);
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
