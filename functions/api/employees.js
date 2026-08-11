import { neon } from '@neondatabase/serverless';
import {
  ROLES,
  authorize,
  clientIdsFor,
  enforceRateLimit,
  handlePreflight,
  publicError,
  secureJson,
} from './_security.js';

const METHODS = 'GET, POST, OPTIONS';

function getUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

const BASIC_FIELDS = new Set([
  'id', 'clientId', 'company', 'name', 'status', 'employmentType', 'joinDate',
  'contractStart', 'contractEnd', 'resignDate', 'region', 'province', 'project', 'position',
]);
const CONTROLLER_BLOCKED_FIELDS = new Set([
  'motherName', 'religion', 'birthPlace', 'birthDate', 'address', 'educationLevel',
  'schoolName', 'major', 'hrisUser', 'inputUser', 'inputAt',
]);

function employeeView(row, actor) {
  if (['SUPER_ADMIN', 'PAYROLL_PROCESSOR'].includes(actor.role)) return row;
  if (actor.role === 'PAYROLL_CONTROLLER') {
    return Object.fromEntries(Object.entries(row).filter(([key]) => !CONTROLLER_BLOCKED_FIELDS.has(key)));
  }
  if (actor.role === 'CLIENT_USER') return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => BASIC_FIELDS.has(key)));
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env, METHODS);
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: request.method === 'POST' ? ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'CLIENT_USER'] : ROLES,
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;

  const rateLimited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    request.method === 'POST' ? 'employees-write' : 'employees-read',
    METHODS
  );
  if (rateLimited) return rateLimited;

  const respond = (data, status = 200) =>
    secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();

  try {
    const url = getUrl(env);
    if (!url) return respond({ status: 'error', message: 'Service unavailable', requestId }, 503);

    const sql = neon(url);
    const actor = authorization.actor;
    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS payroll_source_period TEXT`);
    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS imported_gross BIGINT DEFAULT 0`);
    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS imported_deduction BIGINT DEFAULT 0`);
    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS imported_net BIGINT DEFAULT 0`);
    await sql.query(`ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS payroll_components JSONB DEFAULT '{}'::jsonb`);

    if (request.method === 'GET') {
      const scopedClientIds = clientIdsFor(actor, env);
      const clientScopeCsv = (scopedClientIds || []).join(',');
      const rows = await sql`
        SELECT
          e.id,
          e.client_id AS "clientId",
          c.name AS company,
          e.name,
          e.gender,
          e.birth_place AS "birthPlace",
          e.birth_date AS "birthDate",
          e.religion,
          e.phone,
          e.mobile,
          e.mother_name AS "motherName",
          a.position,
          a.pic,
          a.hrbp,
          COALESCE(ec.contract_status, e.status_aktif) AS status,
          ec.employment_type AS "employmentType",
          ec.join_date AS "joinDate",
          ec.accepted_date AS "acceptedDate",
          ec.contract_start AS "contractStart",
          ec.contract_end AS "contractEnd",
          ec.resign_date AS "resignDate",
          ec.resign_reason AS "resignReason",
          ec.candidate_source AS "candidateSource",
          COALESCE(wl.province, e.province, b.province) AS region,
          COALESCE(wl.province, e.province, b.province) AS province,
          COALESCE(wl.unit_kerja, wl.name) AS project,
          COALESCE(cp.basic_salary, 0)::float8 AS "salaryGross",
          cp.payroll_source_period AS "payrollSourcePeriod",
          COALESCE(cp.imported_gross, 0)::float8 AS "importedGross",
          COALESCE(cp.imported_deduction, 0)::float8 AS "importedDeduction",
          COALESCE(cp.imported_net, 0)::float8 AS "importedNet",
          COALESCE(cp.payroll_components, '{}'::jsonb) AS "payrollComponents",
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
          ei.address,
          ei.marital_status AS "maritalStatus",
          ei.ptkp_claimed AS "ptkpClaimed",
          ei.ptkp_updated AS "ptkpUpdated",
          e.email,
          bp.bpjs_kesehatan_no AS "bpjsKesehatanNo",
          bp.bpjs_kesehatan_effective AS "bpjsKesehatanEffective",
          bp.jamsostek_no AS "jamsostekNo",
          (bp.bpjs_kesehatan_no IS NOT NULL) AS "bpjsKesehatan",
          (bp.jamsostek_no IS NOT NULL) AS "bpjsKetenagakerjaan",
          edu.level AS "educationLevel",
          edu.school_name AS "schoolName",
          edu.major,
          edu.graduate_year AS "graduateYear",
          hm.input_user AS "inputUser",
          hm.input_at AS "inputAt",
          hm.fj_input_at AS "fjInputAt",
          hm.fj_input_user AS "fjInputUser",
          hm.es_input_at AS "esInputAt",
          hm.es_input_user AS "esInputUser",
          hm.hris_user AS "hrisUser",
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
          SELECT contract_status, employment_type, join_date, accepted_date, contract_start,
            contract_end, resign_date, resign_reason, candidate_source
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
        LEFT JOIN LATERAL (
          SELECT level, school_name, major, graduate_year
          FROM employee_education
          WHERE employee_id = e.id
          ORDER BY is_highest DESC, graduate_year DESC NULLS LAST
          LIMIT 1
        ) edu ON TRUE
        LEFT JOIN employee_hris_meta hm ON hm.employee_id = e.id
        WHERE ${actor.role !== 'CLIENT_USER'}
          OR e.client_id = ANY(string_to_array(${clientScopeCsv}, ','))
        ORDER BY e.name ASC
        LIMIT 500
      `;
      const visibleRows = rows.map((row) => employeeView(row, actor));
      return respond({ employees: visibleRows, count: visibleRows.length, role: actor.role });
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return respond({ status: 'error', message: 'Invalid JSON' }, 400);
      }
      if (!body.name || !String(body.name).trim()) {
        return respond({ status: 'error', message: 'name required' }, 400);
      }

      const id = body.id || `EMP-${crypto.randomUUID()}`;
      const orgId = body.orgId || body.org_id || 'ORG-OTSINDO';
      const clientId = body.clientId || body.client_id || null;
      const branchId = body.branchId || body.branch_id || null;
      const locationId = body.locationId || body.location_id || null;
      const status = body.statusAktif || body.status_aktif || body.status || 'TETAP';
      const province = body.province || body.region || null;
      const salaryGross = Number(body.salaryGross ?? body.salary_gross ?? body.basicSalary ?? 0) || 0;

      if (actor.role === 'CLIENT_USER') {
        const scope = clientIdsFor(actor, env) || [];
        const existing = await sql`SELECT client_id FROM employees WHERE id=${id} LIMIT 1`;
        const targetClientId = existing[0]?.client_id || clientId;
        if (!targetClientId || !scope.includes(String(targetClientId))) {
          return respond({ error: 'Karyawan berada di luar client scope Anda.' }, 403);
        }
      }

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

      if (body.nik || body.npwp || body.address) {
        await sql`INSERT INTO employee_identity (employee_id, ktp_no, npwp_no, address)
          VALUES (${id}, ${body.nik || null}, ${body.npwp || null}, ${body.address || null})
          ON CONFLICT (employee_id) DO UPDATE SET ktp_no=COALESCE(EXCLUDED.ktp_no, employee_identity.ktp_no),
            npwp_no=COALESCE(EXCLUDED.npwp_no, employee_identity.npwp_no), address=COALESCE(EXCLUDED.address, employee_identity.address)`;
      }
      if (body.bpjsKesehatanNo || body.jamsostekNo) {
        await sql`INSERT INTO employee_bpjs (employee_id, bpjs_kesehatan_no, jamsostek_no)
          VALUES (${id}, ${body.bpjsKesehatanNo || null}, ${body.jamsostekNo || null})
          ON CONFLICT (employee_id) DO UPDATE SET bpjs_kesehatan_no=COALESCE(EXCLUDED.bpjs_kesehatan_no, employee_bpjs.bpjs_kesehatan_no),
            jamsostek_no=COALESCE(EXCLUDED.jamsostek_no, employee_bpjs.jamsostek_no), updated_at=NOW()`;
      }
      if (body.email) await sql`UPDATE employees SET email=${body.email}, updated_at=NOW() WHERE id=${id}`;

      return respond({ ok: true, id });
    }

    return respond({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
