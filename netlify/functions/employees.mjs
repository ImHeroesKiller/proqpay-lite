import { getSql, json, handleOptions } from './db.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, company, name, position, status, region,
               salary_gross AS "salaryGross", bank_account AS "bankAccount"
        FROM employees
        ORDER BY name ASC
        LIMIT 500
      `;
      return json({ employees: rows, count: rows.length });
    }

    if (req.method === 'POST') {
      const body = await req.json();
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
};

export const config = { path: '/api/employees' };
