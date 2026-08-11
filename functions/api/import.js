import { neon } from '@neondatabase/serverless';
import {
  MAX_IMPORT_BYTES,
  validateImportRows,
} from './import-validation.js';
import {
  authorize,
  clientIdsFor,
  enforceRateLimit,
  handlePreflight,
  publicError,
  secureJson,
} from './_security.js';

const METHODS = 'POST, OPTIONS';

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
    return handlePreflight(request, env, METHODS);
  }
  if (request.method !== 'POST') {
    return secureJson({ error: 'POST only — send { rows: ParsedEmployee[] }' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'CLIENT_USER'],
    mutating: true,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;

  const rateLimited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    'employee-import',
    METHODS
  );
  if (rateLimited) return rateLimited;

  const respond = (data, status = 200) =>
    secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_IMPORT_BYTES) {
    return respond({ error: `Payload maksimal ${MAX_IMPORT_BYTES} byte` }, 413);
  }

  const url = getUrl(env);
  if (!url) return respond({ error: 'Service unavailable', requestId }, 503);

  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_IMPORT_BYTES) {
      return respond({ error: `Payload maksimal ${MAX_IMPORT_BYTES} byte` }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }

  const validation = validateImportRows(body.rows);
  if (!validation.ok) {
    return respond(
      {
        ok: false,
        error: 'Import validation failed',
        issues: validation.issues,
      },
      422
    );
  }

  const rows = validation.rows;
  const sql = neon(url);
  const orgId = 'ORG-OTSINDO';
  const actor = authorization.actor;
  const importContext = body.context && typeof body.context === 'object' ? body.context : null;
  const contextClientId = importContext?.clientId ? String(importContext.clientId) : null;
  const servicePlanId = importContext?.servicePlanId ? String(importContext.servicePlanId) : null;
  const serviceTier = importContext?.tier ? String(importContext.tier) : null;
  const projectId = importContext?.projectId ? String(importContext.projectId) : null;
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(importContext?.period || ''))
    ? String(importContext.period) : new Date().toISOString().slice(0, 7);
  const rowClientId = (row) =>
    contextClientId || `CLI-${slug(row.clientCode || row.client || row.company || 'GEN')}`;

  try {
    let verifiedPlan = null;
    if (importContext) {
      if (!contextClientId || !servicePlanId || !serviceTier) {
        return respond({ error: 'Klien dan service tier wajib ditentukan sebelum import.' }, 409);
      }
      const plans = await sql`SELECT sp.* FROM client_service_plans sp JOIN clients c ON c.id=sp.client_id
        WHERE sp.id=${servicePlanId} AND sp.client_id=${contextClientId} AND sp.tier=${serviceTier}
          AND sp.status='ACTIVE' AND c.org_id=${orgId}
          AND sp.effective_from <= CURRENT_DATE AND (sp.effective_until IS NULL OR sp.effective_until >= CURRENT_DATE) LIMIT 1`;
      if (!plans.length) return respond({ error: 'Service tier klien belum aktif atau tidak cocok.' }, 409);
      verifiedPlan = plans[0];
      const lockedPayroll = await sql`SELECT id, status FROM payrolls WHERE org_id=${orgId} AND period=${period}
        AND status NOT IN ('DRAFT','CALCULATED') LIMIT 1`;
      if (lockedPayroll.length) return respond({ error: `Payroll ${period} sudah ${lockedPayroll[0].status}; gunakan alur revisi controller sebelum mengganti sumber data.` }, 409);
    }

    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS payroll_source_period TEXT`);
    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS imported_gross BIGINT DEFAULT 0`);
    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS imported_deduction BIGINT DEFAULT 0`);
    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS imported_net BIGINT DEFAULT 0`);
    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS payroll_components JSONB DEFAULT '{}'::jsonb`);
    await sql.query(`ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id)`);

    if (actor.role === 'CLIENT_USER') {
      const allowedClientIds = clientIdsFor(actor, env) || [];
      const requestedClientIds = [...new Set(rows.map(rowClientId))];
      if (
        !allowedClientIds.length ||
        requestedClientIds.some((clientId) => !allowedClientIds.includes(clientId))
      ) {
        return respond(
          { error: 'Import hanya boleh untuk klien yang ditetapkan pada akun Anda.' },
          403
        );
      }

      const scopedEmployees = await sql`
        SELECT id, client_id AS "clientId"
        FROM employees
        WHERE id = ANY(${rows.map((row) => row.nrk)}::text[])
      `;
      if (scopedEmployees.some((employee) => !allowedClientIds.includes(employee.clientId))) {
        return respond(
          { error: 'Import memuat ID karyawan milik klien lain.' },
          403
        );
      }
    }

    const existing = await sql`
      SELECT id FROM employees
      WHERE id = ANY(${rows.map((row) => row.nrk)}::text[])
    `;
    const existingIds = new Set(existing.map((row) => row.id));
    const inserted = rows.filter((row) => !existingIds.has(row.nrk)).length;
    const updated = rows.length - inserted;
    const provinceStats = {};
    rows.forEach((row) => {
      const province = row.province || 'Tidak diketahui';
      provinceStats[province] = (provinceStats[province] || 0) + 1;
    });

    await sql.transaction((tx) => {
      const queries = [
        tx`
          INSERT INTO organizations (id, name, code)
          VALUES (${orgId}, 'OTSINDO', 'OTSINDO')
          ON CONFLICT (id) DO NOTHING
        `,
      ];

      for (const row of rows) {
        const clientId = rowClientId(row);
        const branchId = `BR-${slug(row.branch || 'NA')}`;
        const locationId = `LOC-${slug(row.lokasi || row.branch || row.nrk)}`;
        const contractId = `CTR-${row.nrk}`;
        const assignmentId = `ASG-${row.nrk}`;

        queries.push(
          tx`
            INSERT INTO clients (id, org_id, code, name)
            VALUES (
              ${clientId},
              ${orgId},
              ${String(row.clientCode || slug(row.client || row.company || 'GEN'))},
              ${String(row.client || row.company || 'Unknown')}
            )
            ON CONFLICT (id) DO UPDATE SET
              name = CASE
                WHEN ${actor.role === 'CLIENT_USER'} THEN clients.name
                ELSE EXCLUDED.name
              END
          `,
          tx`
            INSERT INTO branches (id, org_id, name, city_umk, province)
            VALUES (
              ${branchId}, ${orgId}, ${String(row.branch || 'NA')},
              ${row.kotaUmk || null}, ${row.province || null}
            )
            ON CONFLICT (id) DO UPDATE SET
              city_umk = COALESCE(EXCLUDED.city_umk, branches.city_umk),
              province = COALESCE(EXCLUDED.province, branches.province)
          `,
          tx`
            INSERT INTO work_locations (id, branch_id, name, unit_kerja, province, city_umk)
            VALUES (
              ${locationId}, ${branchId}, ${String(row.lokasi || row.branch || 'UNKNOWN')},
              ${row.unitKerja || null}, ${row.province || 'Tidak diketahui'}, ${row.kotaUmk || null}
            )
            ON CONFLICT (id) DO UPDATE SET
              province = EXCLUDED.province,
              unit_kerja = COALESCE(EXCLUDED.unit_kerja, work_locations.unit_kerja),
              city_umk = COALESCE(EXCLUDED.city_umk, work_locations.city_umk)
          `,
          tx`
            INSERT INTO employees (
              id, org_id, client_id, branch_id, location_id, name, gender,
              birth_place, birth_date, religion, phone, mobile, email, mother_name,
              status_aktif, province, updated_at
            ) VALUES (
              ${row.nrk}, ${orgId}, ${clientId}, ${branchId}, ${locationId}, ${row.name},
              ${row.gender || null}, ${row.birthPlace || null}, ${row.birthDate || null},
              ${row.religion || null}, ${row.phone || null}, ${row.mobile || null},
              ${row.email || null}, ${row.motherName || null}, ${row.statusAktif || null},
              ${row.province || null}, NOW()
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
          `,
          tx`
            INSERT INTO employee_identity (
              employee_id, ktp_no, npwp_no, address, marital_status, ptkp_claimed, ptkp_updated
            ) VALUES (
              ${row.nrk}, ${row.ktp || null}, ${row.npwp || null}, ${row.address || null},
              ${row.marital || null}, ${row.ptkpClaimed || null}, ${row.ptkpUpdated || null}
            )
            ON CONFLICT (employee_id) DO UPDATE SET
              ktp_no = EXCLUDED.ktp_no,
              npwp_no = EXCLUDED.npwp_no,
              address = EXCLUDED.address,
              marital_status = EXCLUDED.marital_status,
              ptkp_claimed = EXCLUDED.ptkp_claimed,
              ptkp_updated = EXCLUDED.ptkp_updated
          `,
          tx`
            INSERT INTO employee_contracts (
              id, employee_id, employment_type, contract_status, join_date, accepted_date,
              contract_start, contract_end, resign_date, resign_reason, candidate_source, is_current
            ) VALUES (
              ${contractId}, ${row.nrk}, ${row.employmentType || null},
              ${row.contractStatus || null}, ${row.joinDate || null}, ${row.acceptedDate || null},
              ${row.contractStart || null}, ${row.contractEnd || null}, ${row.resignDate || null},
              ${row.resignReason || null}, ${row.candidateSource || null}, TRUE
            )
            ON CONFLICT (id) DO UPDATE SET
              employment_type = EXCLUDED.employment_type,
              contract_status = EXCLUDED.contract_status,
              join_date = EXCLUDED.join_date,
              accepted_date = EXCLUDED.accepted_date,
              contract_start = EXCLUDED.contract_start,
              contract_end = EXCLUDED.contract_end,
              resign_date = EXCLUDED.resign_date,
              resign_reason = EXCLUDED.resign_reason,
              candidate_source = EXCLUDED.candidate_source,
              is_current = TRUE
          `,
          tx`
            INSERT INTO employee_assignments (id, employee_id, position, pic, hrbp, is_current)
            VALUES (
              ${assignmentId}, ${row.nrk}, ${row.position || null},
              ${row.pic || null}, ${row.hrbp || null}, TRUE
            )
            ON CONFLICT (id) DO UPDATE SET
              position = EXCLUDED.position,
              pic = EXCLUDED.pic,
              hrbp = EXCLUDED.hrbp,
              is_current = TRUE
          `,
          tx`
            INSERT INTO employee_compensation (employee_id, basic_salary, salary_start, payroll_source_period,
              imported_gross, imported_deduction, imported_net, payroll_components)
            VALUES (${row.nrk}, ${row.basicSalary || 0}, ${row.salaryStart || null}, ${period},
              ${row.grossPay || 0}, ${row.totalDeductions || 0}, ${row.netPay || 0},
              ${JSON.stringify(row.payrollComponents || {})}::jsonb)
            ON CONFLICT (employee_id) DO UPDATE SET
              basic_salary = EXCLUDED.basic_salary,
              salary_start = EXCLUDED.salary_start,
              payroll_source_period = EXCLUDED.payroll_source_period,
              imported_gross = EXCLUDED.imported_gross,
              imported_deduction = EXCLUDED.imported_deduction,
              imported_net = EXCLUDED.imported_net,
              payroll_components = EXCLUDED.payroll_components,
              updated_at = NOW()
          `,
          tx`
            INSERT INTO employee_bpjs (
              employee_id, bpjs_kesehatan_no, bpjs_kesehatan_effective, jamsostek_no
            ) VALUES (
              ${row.nrk}, ${row.bpjsKes || null}, ${row.bpjsKesEffective || null},
              ${row.jamsostek || null}
            )
            ON CONFLICT (employee_id) DO UPDATE SET
              bpjs_kesehatan_no = EXCLUDED.bpjs_kesehatan_no,
              bpjs_kesehatan_effective = EXCLUDED.bpjs_kesehatan_effective,
              jamsostek_no = EXCLUDED.jamsostek_no,
              updated_at = NOW()
          `,
          tx`
            INSERT INTO employee_hris_meta (employee_id, hris_user)
            VALUES (${row.nrk}, ${row.hrisUser || null})
            ON CONFLICT (employee_id) DO UPDATE SET hris_user = EXCLUDED.hris_user
          `
        );

        if (row.bank || row.accountNo) {
          const bankId = `BNK-${row.nrk}`;
          queries.push(tx`
            INSERT INTO employee_bank_accounts (
              id, employee_id, bank_name, account_no, is_primary
            ) VALUES (
              ${bankId}, ${row.nrk}, ${row.bank || null}, ${row.accountNo || null}, TRUE
            )
            ON CONFLICT (id) DO UPDATE SET
              bank_name = EXCLUDED.bank_name,
              account_no = EXCLUDED.account_no,
              is_primary = TRUE
          `);
        }

        if (row.educationLevel || row.school) {
          const educationId = `EDU-${row.nrk}`;
          queries.push(tx`
            INSERT INTO employee_education (
              id, employee_id, level, school_name, major, graduate_year, is_highest
            ) VALUES (
              ${educationId}, ${row.nrk}, ${row.educationLevel || null},
              ${row.school || null}, ${row.major || null}, ${row.graduateYear || null}, TRUE
            )
            ON CONFLICT (id) DO UPDATE SET
              level = EXCLUDED.level,
              school_name = EXCLUDED.school_name,
              major = EXCLUDED.major,
              graduate_year = EXCLUDED.graduate_year,
              is_highest = TRUE
          `);
        }
      }

      const submissionId = verifiedPlan ? `SUB-${crypto.randomUUID()}` : null;
      if (verifiedPlan) {
        queries.push(tx`DELETE FROM payrolls WHERE org_id=${orgId} AND period=${period} AND status IN ('DRAFT','CALCULATED')`);
      }
      if (submissionId) {
        queries.push(tx`INSERT INTO payroll_submissions
          (id, org_id, client_id, project_id, service_plan_id, service_tier, period, state, created_by)
          VALUES (${submissionId}, ${orgId}, ${contextClientId}, ${projectId}, ${servicePlanId}, ${serviceTier},
            ${period}, 'AI_VALIDATING', ${actor.email})`);
      }
      queries.push(tx`
        INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity)
        VALUES (
          ${'LOG-IMP-' + crypto.randomUUID()},
          ${orgId},
          ${authorization.actor.email},
          ${authorization.actor.role},
          'EMPLOYEE_IMPORT',
          ${`Import ${inserted} new, ${updated} updated, 0 errors`},
          'Employee'
        )
      `);
      return queries;
    });

    const latestSubmission = verifiedPlan
      ? await sql`SELECT id FROM payroll_submissions WHERE org_id=${orgId} AND client_id=${contextClientId}
          AND service_plan_id=${servicePlanId} AND period=${period} ORDER BY created_at DESC LIMIT 1`
      : [];

    return respond({
      ok: true,
      atomic: true,
      inserted,
      updated,
      errors: 0,
      errorSamples: [],
      provinceStats,
      total: rows.length,
      submissionId: latestSubmission[0]?.id || null,
      serviceTier,
      clientId: contextClientId,
      projectId,
    });
  } catch (error) {
    return respond(
      {
        ok: false,
        atomic: true,
        error: 'Import transaction failed',
        ...publicError(error, requestId),
      },
      500
    );
  }
}
