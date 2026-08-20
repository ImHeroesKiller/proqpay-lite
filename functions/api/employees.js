import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import {
  ROLES,
  authorize,
  clientIdsFor,
  projectIdsFor,
  enforceRateLimit,
  handlePreflight,
  publicError,
  secureJson,
} from './_security.js';

const METHODS = 'GET, POST, OPTIONS';

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
    if (!hasD1(env)) return respond({ status: 'error', message: 'Cloudflare D1 unavailable', requestId }, 503);
    const database = env.DB;
    const actor = authorization.actor;

    if (request.method === 'GET') {
      const scopedClientIds = clientIdsFor(actor, env);
      const scopedProjectIds = projectIdsFor(actor);
      if (actor.role === 'CLIENT_USER' && !scopedClientIds?.length) {
        return respond({ employees: [], count: 0, role: actor.role });
      }
      const clientFilter = actor.role === 'CLIENT_USER'
        ? ` AND e.client_id IN (${scopedClientIds.map(() => '?').join(',')})`
        : '';
      const projectFilter = actor.role === 'CLIENT_USER' && scopedProjectIds?.length
        ? ` AND e.project_id IN (${scopedProjectIds.map(() => '?').join(',')})`
        : '';
      const rows = await d1All(database, `
        SELECT
          e.id,
          e.employee_code AS "employeeCode",
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
          (SELECT position FROM employee_assignments WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS position,
          (SELECT pic FROM employee_assignments WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS pic,
          (SELECT hrbp FROM employee_assignments WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS hrbp,
          COALESCE((SELECT contract_status FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1), e.status_aktif) AS status,
          (SELECT employment_type FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS "employmentType",
          (SELECT join_date FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS "joinDate",
          (SELECT accepted_date FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS "acceptedDate",
          (SELECT contract_start FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS "contractStart",
          (SELECT contract_end FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS "contractEnd",
          (SELECT resign_date FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS "resignDate",
          (SELECT resign_reason FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS "resignReason",
          (SELECT candidate_source FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS "candidateSource",
          COALESCE(wl.province, e.province, b.province) AS region,
          COALESCE(wl.province, e.province, b.province) AS province,
          COALESCE(p.name, wl.unit_kerja, wl.name) AS project,
          e.project_id AS "projectId",
          COALESCE(cp.basic_salary, 0) AS "salaryGross",
          cp.payroll_source_period AS "payrollSourcePeriod",
          COALESCE(cp.imported_gross, 0) AS "importedGross",
          COALESCE(cp.imported_deduction, 0) AS "importedDeduction",
          COALESCE(cp.imported_net, 0) AS "importedNet",
          COALESCE(cp.payroll_components, '{}') AS "payrollComponents",
          0 AS "allowanceTransport",
          0 AS "allowanceMeal",
          (SELECT account_no FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 ORDER BY created_at DESC LIMIT 1) AS "accountNo",
          CASE
            WHEN (SELECT account_no FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) IS NULL THEN ''
            WHEN (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) IS NULL
              THEN (SELECT account_no FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1)
            ELSE (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1)
              || '-' || (SELECT account_no FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1)
          END AS "bankAccount",
          (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 ORDER BY created_at DESC LIMIT 1) AS "bankName",
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
          (SELECT level FROM employee_education WHERE employee_id=e.id ORDER BY is_highest DESC, graduate_year DESC LIMIT 1) AS "educationLevel",
          (SELECT school_name FROM employee_education WHERE employee_id=e.id ORDER BY is_highest DESC, graduate_year DESC LIMIT 1) AS "schoolName",
          (SELECT major FROM employee_education WHERE employee_id=e.id ORDER BY is_highest DESC, graduate_year DESC LIMIT 1) AS major,
          (SELECT graduate_year FROM employee_education WHERE employee_id=e.id ORDER BY is_highest DESC, graduate_year DESC LIMIT 1) AS "graduateYear",
          hm.input_user AS "inputUser",
          hm.input_at AS "inputAt",
          hm.fj_input_at AS "fjInputAt",
          hm.fj_input_user AS "fjInputUser",
          hm.es_input_at AS "esInputAt",
          hm.es_input_user AS "esInputUser",
          hm.hris_user AS "hrisUser",
          1 AS pph21
        FROM employees e
        LEFT JOIN clients c ON c.id = e.client_id
        LEFT JOIN projects p ON p.id = e.project_id
        LEFT JOIN branches b ON b.id = e.branch_id
        LEFT JOIN work_locations wl ON wl.id = e.location_id
        LEFT JOIN employee_compensation cp ON cp.employee_id = e.id
        LEFT JOIN employee_identity ei ON ei.employee_id = e.id
        LEFT JOIN employee_bpjs bp ON bp.employee_id = e.id
        LEFT JOIN employee_hris_meta hm ON hm.employee_id = e.id
        WHERE 1=1${clientFilter}${projectFilter}
        ORDER BY e.name ASC
        LIMIT 500
      `, [...(actor.role === 'CLIENT_USER' ? scopedClientIds : []), ...(actor.role === 'CLIENT_USER' && scopedProjectIds?.length ? scopedProjectIds : [])]);
      const visibleRows = rows.map((row) => {
        try { row.payrollComponents = JSON.parse(row.payrollComponents || '{}'); } catch { row.payrollComponents = {}; }
        row.bpjsKesehatan = Boolean(row.bpjsKesehatan);
        row.bpjsKetenagakerjaan = Boolean(row.bpjsKetenagakerjaan);
        row.pph21 = Boolean(row.pph21);
        return employeeView(row, actor);
      });
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
      const projectId = body.projectId || body.project_id || null;
      const status = body.statusAktif || body.status_aktif || body.status || 'TETAP';
      const province = body.province || body.region || null;
      const salaryGross = Number(body.salaryGross ?? body.salary_gross ?? body.basicSalary ?? 0) || 0;

      if (actor.role === 'CLIENT_USER') {
        const scope = clientIdsFor(actor, env) || [];
        const projectScope = projectIdsFor(actor) || [];
        const existing = await d1First(database, 'SELECT client_id, project_id FROM employees WHERE id=? LIMIT 1', [id]);
        const targetClientId = existing?.client_id || clientId;
        const targetProjectId = existing?.project_id || projectId;
        if (!targetClientId || !scope.includes(String(targetClientId))) {
          return respond({ error: 'Karyawan berada di luar client scope Anda.' }, 403);
        }
        if (projectScope.length && (!targetProjectId || !projectScope.includes(String(targetProjectId)))) {
          return respond({ error: 'Karyawan berada di luar project scope Anda.' }, 403);
        }
      }

      const operations = [
        { statement: `INSERT OR IGNORE INTO organizations (id, name, code) VALUES (?, ?, ?)`,
          bindings: [orgId, body.orgName || 'OTSINDO', body.orgCode || 'OTSINDO'] },
        { statement: `INSERT INTO employees (
          id, org_id, client_id, project_id, branch_id, location_id, employee_code, name, status_aktif, province, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT (id) DO UPDATE SET
          name=excluded.name, client_id=excluded.client_id,
          project_id=COALESCE(excluded.project_id, employees.project_id), branch_id=excluded.branch_id,
          location_id=excluded.location_id, employee_code=COALESCE(employees.employee_code, excluded.employee_code),
          status_aktif=excluded.status_aktif, province=excluded.province,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
          bindings: [id, orgId, clientId, projectId, branchId, locationId, String(body.employeeCode || (String(id).startsWith('EMP-') ? id : `EMP-${id}`)), String(body.name).trim(), status, province] },
        { statement: `INSERT INTO employee_compensation (employee_id, basic_salary) VALUES (?, ?)
          ON CONFLICT (employee_id) DO UPDATE SET basic_salary=excluded.basic_salary,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`, bindings: [id, salaryGross] },
      ];

      if (body.position) {
        const assignmentId = `ASG-${id}`;
        operations.push({ statement: `INSERT INTO employee_assignments (id, employee_id, position, is_current)
          VALUES (?, ?, ?, 1) ON CONFLICT (id) DO UPDATE SET position=excluded.position, is_current=1`,
          bindings: [assignmentId, id, body.position] });
      }

      const accountNo = body.accountNo || body.bankAccount || body.bank_account || null;
      if (accountNo) {
        const bankId = `BNK-${id}`;
        operations.push(
          { statement: 'UPDATE employee_bank_accounts SET is_primary=0 WHERE employee_id=? AND id<>?', bindings: [id, bankId] },
          { statement: `INSERT INTO employee_bank_accounts (id, employee_id, bank_name, account_no, is_primary)
            VALUES (?, ?, ?, ?, 1) ON CONFLICT (id) DO UPDATE SET bank_name=excluded.bank_name,
            account_no=excluded.account_no, is_primary=1`, bindings: [bankId, id, body.bankName || null, accountNo] }
        );
      }

      if (body.nik || body.npwp || body.address) {
        operations.push({ statement: `INSERT INTO employee_identity (employee_id, ktp_no, npwp_no, address)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (employee_id) DO UPDATE SET ktp_no=COALESCE(EXCLUDED.ktp_no, employee_identity.ktp_no),
            npwp_no=COALESCE(EXCLUDED.npwp_no, employee_identity.npwp_no), address=COALESCE(EXCLUDED.address, employee_identity.address)`,
          bindings: [id, body.nik || null, body.npwp || null, body.address || null] });
      }
      if (body.bpjsKesehatanNo || body.jamsostekNo) {
        operations.push({ statement: `INSERT INTO employee_bpjs (employee_id, bpjs_kesehatan_no, jamsostek_no)
          VALUES (?, ?, ?)
          ON CONFLICT (employee_id) DO UPDATE SET bpjs_kesehatan_no=COALESCE(EXCLUDED.bpjs_kesehatan_no, employee_bpjs.bpjs_kesehatan_no),
            jamsostek_no=COALESCE(EXCLUDED.jamsostek_no, employee_bpjs.jamsostek_no), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
          bindings: [id, body.bpjsKesehatanNo || null, body.jamsostekNo || null] });
      }
      if (body.email) operations.push({ statement: `UPDATE employees SET email=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, bindings: [body.email, id] });

      await d1Batch(database, operations);

      return respond({ ok: true, id });
    }

    return respond({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
