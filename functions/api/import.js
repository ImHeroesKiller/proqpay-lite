import { neon } from '@neondatabase/serverless';

function getUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

function slug(s) {
  return String(s || 'X')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  if (request.method !== 'POST') {
    return json({ error: 'POST only — send { rows: ParsedEmployee[] }' }, 405);
  }

  const url = getUrl(env);
  if (!url) return json({ error: 'DATABASE_URL missing' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const rows = body.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return json({ error: 'rows[] required' }, 400);
  }

  const sql = neon(url);
  const orgId = 'ORG-OTSINDO';

  let inserted = 0;
  let updated = 0;
  let errors = [];
  const provinceStats = {};

  // Ensure org
  await sql`
    INSERT INTO organizations (id, name, code)
    VALUES (${orgId}, 'OTSINDO', 'OTSINDO')
    ON CONFLICT (id) DO NOTHING
  `;

  for (const r of rows) {
    try {
      if (!r.nrk || !r.name) continue;

      const clientId = `CLI-${slug(r.clientCode || r.client || 'GEN')}`;
      await sql`
        INSERT INTO clients (id, org_id, code, name)
        VALUES (${clientId}, ${orgId}, ${String(r.clientCode || '000')}, ${String(r.client || 'Unknown')})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `;

      const branchId = `BR-${slug(r.branch || 'NA')}`;
      await sql`
        INSERT INTO branches (id, org_id, name, city_umk, province)
        VALUES (${branchId}, ${orgId}, ${String(r.branch || 'NA')}, ${r.kotaUmk || null}, ${r.province || null})
        ON CONFLICT (id) DO UPDATE SET
          city_umk = COALESCE(EXCLUDED.city_umk, branches.city_umk),
          province = COALESCE(EXCLUDED.province, branches.province)
      `;

      const locId = `LOC-${slug(r.lokasi || r.branch || r.nrk)}`;
      await sql`
        INSERT INTO work_locations (id, branch_id, name, unit_kerja, province, city_umk)
        VALUES (
          ${locId}, ${branchId}, ${String(r.lokasi || r.branch || 'UNKNOWN')},
          ${r.unitKerja || null}, ${r.province || 'Tidak diketahui'}, ${r.kotaUmk || null}
        )
        ON CONFLICT (id) DO UPDATE SET
          province = EXCLUDED.province,
          unit_kerja = COALESCE(EXCLUDED.unit_kerja, work_locations.unit_kerja),
          city_umk = COALESCE(EXCLUDED.city_umk, work_locations.city_umk)
      `;

      const existing = await sql`SELECT id FROM employees WHERE id = ${r.nrk} LIMIT 1`;
      const isUpdate = existing.length > 0;

      await sql`
        INSERT INTO employees (
          id, org_id, client_id, branch_id, location_id, name, gender,
          birth_place, birth_date, religion, phone, mobile, email, mother_name,
          status_aktif, province, updated_at
        ) VALUES (
          ${r.nrk}, ${orgId}, ${clientId}, ${branchId}, ${locId}, ${r.name}, ${r.gender || null},
          ${r.birthPlace || null}, ${r.birthDate || null}, ${r.religion || null},
          ${r.phone || null}, ${r.mobile || null}, ${r.email || null}, ${r.motherName || null},
          ${r.statusAktif || null}, ${r.province || null}, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          client_id = EXCLUDED.client_id,
          branch_id = EXCLUDED.branch_id,
          location_id = EXCLUDED.location_id,
          gender = EXCLUDED.gender,
          birth_place = EXCLUDED.birth_place,
          birth_date = EXCLUDED.birth_date,
          religion = EXCLUDED.religion,
          phone = EXCLUDED.phone,
          mobile = EXCLUDED.mobile,
          email = EXCLUDED.email,
          mother_name = EXCLUDED.mother_name,
          status_aktif = EXCLUDED.status_aktif,
          province = EXCLUDED.province,
          updated_at = NOW()
      `;

      await sql`
        INSERT INTO employee_identity (employee_id, ktp_no, npwp_no, address, marital_status, ptkp_claimed, ptkp_updated)
        VALUES (${r.nrk}, ${r.ktp || null}, ${r.npwp || null}, ${r.address || null},
          ${r.marital || null}, ${r.ptkpClaimed || null}, ${r.ptkpUpdated || null})
        ON CONFLICT (employee_id) DO UPDATE SET
          ktp_no = EXCLUDED.ktp_no, npwp_no = EXCLUDED.npwp_no, address = EXCLUDED.address,
          marital_status = EXCLUDED.marital_status, ptkp_claimed = EXCLUDED.ptkp_claimed,
          ptkp_updated = EXCLUDED.ptkp_updated
      `;

      const contractId = `CTR-${r.nrk}`;
      await sql`
        INSERT INTO employee_contracts (
          id, employee_id, employment_type, contract_status, join_date, accepted_date,
          contract_start, contract_end, resign_date, resign_reason, candidate_source, is_current
        ) VALUES (
          ${contractId}, ${r.nrk}, ${r.employmentType || null}, ${r.contractStatus || null},
          ${r.joinDate || null}, ${r.acceptedDate || null},
          ${r.contractStart || null}, ${r.contractEnd || null}, ${r.resignDate || null},
          ${r.resignReason || null}, ${r.candidateSource || null}, true
        )
        ON CONFLICT (id) DO UPDATE SET
          employment_type = EXCLUDED.employment_type,
          contract_status = EXCLUDED.contract_status,
          join_date = EXCLUDED.join_date,
          contract_start = EXCLUDED.contract_start,
          contract_end = EXCLUDED.contract_end,
          resign_date = EXCLUDED.resign_date,
          resign_reason = EXCLUDED.resign_reason
      `;

      const asgId = `ASG-${r.nrk}`;
      await sql`
        INSERT INTO employee_assignments (id, employee_id, position, pic, hrbp, is_current)
        VALUES (${asgId}, ${r.nrk}, ${r.position || null}, ${r.pic || null}, ${r.hrbp || null}, true)
        ON CONFLICT (id) DO UPDATE SET
          position = EXCLUDED.position, pic = EXCLUDED.pic, hrbp = EXCLUDED.hrbp
      `;

      await sql`
        INSERT INTO employee_compensation (employee_id, basic_salary, salary_start)
        VALUES (${r.nrk}, ${r.basicSalary || 0}, ${r.salaryStart || null})
        ON CONFLICT (employee_id) DO UPDATE SET
          basic_salary = EXCLUDED.basic_salary,
          salary_start = EXCLUDED.salary_start,
          updated_at = NOW()
      `;

      if (r.bank || r.accountNo) {
        const bankId = `BNK-${r.nrk}`;
        await sql`
          INSERT INTO employee_bank_accounts (id, employee_id, bank_name, account_no, is_primary)
          VALUES (${bankId}, ${r.nrk}, ${r.bank || null}, ${r.accountNo || null}, true)
          ON CONFLICT (id) DO UPDATE SET
            bank_name = EXCLUDED.bank_name, account_no = EXCLUDED.account_no
        `;
      }

      await sql`
        INSERT INTO employee_bpjs (employee_id, bpjs_kesehatan_no, bpjs_kesehatan_effective, jamsostek_no)
        VALUES (${r.nrk}, ${r.bpjsKes || null}, ${r.bpjsKesEffective || null}, ${r.jamsostek || null})
        ON CONFLICT (employee_id) DO UPDATE SET
          bpjs_kesehatan_no = EXCLUDED.bpjs_kesehatan_no,
          bpjs_kesehatan_effective = EXCLUDED.bpjs_kesehatan_effective,
          jamsostek_no = EXCLUDED.jamsostek_no,
          updated_at = NOW()
      `;

      if (r.educationLevel || r.school) {
        const eduId = `EDU-${r.nrk}`;
        await sql`
          INSERT INTO employee_education (id, employee_id, level, school_name, major, graduate_year, is_highest)
          VALUES (${eduId}, ${r.nrk}, ${r.educationLevel || null}, ${r.school || null},
            ${r.major || null}, ${r.graduateYear || null}, true)
          ON CONFLICT (id) DO UPDATE SET
            level = EXCLUDED.level, school_name = EXCLUDED.school_name,
            major = EXCLUDED.major, graduate_year = EXCLUDED.graduate_year
        `;
      }

      await sql`
        INSERT INTO employee_hris_meta (employee_id, hris_user)
        VALUES (${r.nrk}, ${r.hrisUser || null})
        ON CONFLICT (employee_id) DO UPDATE SET hris_user = EXCLUDED.hris_user
      `;

      if (isUpdate) updated++;
      else inserted++;

      const p = r.province || 'Tidak diketahui';
      provinceStats[p] = (provinceStats[p] || 0) + 1;
    } catch (err) {
      errors.push({ nrk: r.nrk, error: err?.message || String(err) });
      if (errors.length > 30) break;
    }
  }

  await sql`
    INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity)
    VALUES (
      ${'LOG-IMP-' + Date.now()},
      ${orgId},
      'import',
      'SYSTEM',
      'EMPLOYEE_IMPORT',
      ${`Import ${inserted} new, ${updated} updated, ${errors.length} errors`},
      'Employee'
    )
  `;

  return json({
    ok: true,
    inserted,
    updated,
    errors: errors.length,
    errorSamples: errors.slice(0, 10),
    provinceStats,
    total: rows.length,
  });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}
