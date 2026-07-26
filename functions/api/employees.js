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
        SELECT
          e.id,
          c.name AS company,
          e.name,
          a.position,
          a.pic,
          a.hrbp,
          COALESCE(ec.contract_status, e.status_aktif) AS status,
          ec.join_date AS "joinDate",
          COALESCE(wl.province, e.province, b.province) AS region,
          COALESCE(wl.province, e.province, b.province) AS province,
          COALESCE(wl.unit_kerja, wl.name) AS project,
          COALESCE(cp.basic_salary, 0)::float8 AS "salaryGross",
          0 AS "allowanceTransport",
          0 AS "allowanceMeal",
          ba.account_no AS "accountNo",
          CASE
            WHEN ba.account_no IS NULL THEN ''
            WHEN ba.bank_name IS NULL THEN ba.account_no
            ELSE ba.bank_name || '-' || ba.account_no
          END AS "bankAccount",
          ba.bank_name AS "bankName",
          ei.ktp_no AS nik,
          ei.npwp_no AS npwp,
          e.email,
          (bp.bpjs_kesehatan_no IS NOT NULL) AS "bpjsKesehatan",
          (bp.jamsostek_no IS NOT NULL) AS "bpjsKetenagakerjaan",
          TRUE AS pph21
        FROM employees e
        LEFT JOIN clients c ON c.id = e.client_id
        LEFT JOIN branches b ON b.id = e.branch_id
        LEFT JOIN work_locations wl ON wl.id = e.location_id
        LEFT JOIN LATERAL (
          SELECT position, pic, hrbp
          FROM employee_assignments
          WHERE employee_id = e.id AND is_current = TRUE
          ORDER BY created_at DESC
          LIMIT 1
        ) a ON TRUE
        LEFT JOIN LATERAL (
          SELECT contract_status, join_date
          FROM employee_contracts
          WHERE employee_id = e.id AND is_current = TRUE
          ORDER BY created_at DESC
          LIMIT 1
        ) ec ON TRUE
        LEFT JOIN employee_compensation cp ON cp.employee_id = e.id
        LEFT JOIN LATERAL (
          SELECT account_no, bank_name
          FROM employee_bank_accounts
          WHERE employee_id = e.id AND is_primary = TRUE
          ORDER BY created_at DESC
          LIMIT 1
        ) ba ON TRUE
        LEFT JOIN employee_identity ei ON ei.employee_id = e.id
        LEFT JOIN employee_bpjs bp ON bp.employee_id = e.id
        ORDER BY e.name ASC
        LIMIT 500
      `;
      return json({ employees: rows, count: rows.length });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      if (!body.name || !String(body.name).trim()) {
        return json({ status: 'error', message: 'name required' }, 400);
      }

      const id = body.id || `EMP${Date.now()}`;
      const orgId = body.orgId || body.org_id || 'ORG-OTSINDO';
      const clientId = body.clientId || body.client_id || null;
      const branchId = body.branchId || body.branch_id || null;
      const locationId = body.locationId || body.location_id || null;
      const status = body.statusAktif || body.status_aktif || body.status || 'TETAP';
      const province = body.province || body.region || null;
      const salaryGross = Number(body.salaryGross ?? body.salary_gross ?? body.basicSalary ?? 0) || 0;

      await sql`
        INSERT INTO organizations (id, name, code)
        VALUES (${orgId}, ${body.orgName || 'OTSINDO'}, ${body.orgCode || 'OTSINDO'})
        ON CONFLICT (id) DO NOTHING
      `;

      await sql`
        INSERT INTO employees (
          id, org_id, client_id, branch_id, location_id, name, status_aktif, province, updated_at
        )
        VALUES (
          ${id},
          ${orgId},
          ${clientId},
          ${branchId},
          ${locationId},
          ${String(body.name).trim()},
          ${status},
          ${province},
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          client_id = EXCLUDED.client_id,
          branch_id = EXCLUDED.branch_id,
          location_id = EXCLUDED.location_id,
          status_aktif = EXCLUDED.status_aktif,
          province = EXCLUDED.province,
          updated_at = NOW()
      `;

      await sql`
        INSERT INTO employee_compensation (employee_id, basic_salary)
        VALUES (${id}, ${salaryGross})
        ON CONFLICT (employee_id) DO UPDATE SET
          basic_salary = EXCLUDED.basic_salary,
          updated_at = NOW()
      `;

      if (body.position) {
        const assignmentId = `ASG-${id}`;
        await sql`
          INSERT INTO employee_assignments (id, employee_id, position, is_current)
          VALUES (${assignmentId}, ${id}, ${body.position}, TRUE)
          ON CONFLICT (id) DO UPDATE SET
            position = EXCLUDED.position,
            is_current = TRUE
        `;
      }

      const accountNo = body.accountNo || body.bankAccount || body.bank_account || null;
      if (accountNo) {
        const bankId = `BNK-${id}`;
        await sql`
          INSERT INTO employee_bank_accounts (id, employee_id, bank_name, account_no, is_primary)
          VALUES (${bankId}, ${id}, ${body.bankName || null}, ${accountNo}, TRUE)
          ON CONFLICT (id) DO UPDATE SET
            bank_name = EXCLUDED.bank_name,
            account_no = EXCLUDED.account_no,
            is_primary = TRUE
        `;
      }

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
