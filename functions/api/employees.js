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

const SENSITIVE_FIELDS = new Set([
  'nik','npwp','accountNo','bankAccount','bpjsKesehatanNo','jamsostekNo',
  'address','motherName','birthDate','phone','mobile',
]);

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function maskLast4(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  return compact.length <= 4 ? '••••' : `${'•'.repeat(Math.min(8, compact.length - 4))}${compact.slice(-4)}`;
}

function maskEmail(value) {
  const raw = String(value ?? '').trim();
  const [local, domain] = raw.split('@');
  if (!local || !domain) return raw ? '••••' : '';
  return `${local.slice(0, 1)}•••@${domain}`;
}

function employeeView(row, actor) {
  if (actor.permissions?.includes('employees:write')) return row;
  const safe = { ...row };
  for (const field of SENSITIVE_FIELDS) {
    if (!(field in safe)) continue;
    if (field === 'address' || field === 'motherName' || field === 'birthDate') safe[field] = '';
    else safe[field] = maskLast4(safe[field]);
  }
  if ('email' in safe) safe.email = maskEmail(safe.email);
  return Object.fromEntries(Object.entries(safe).filter(([key]) =>
    actor.role !== 'PAYROLL_CONTROLLER' || !CONTROLLER_BLOCKED_FIELDS.has(key)
  ));
}

function validEmail(value) {
  const raw = String(value ?? '').trim();
  return !raw || (raw.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw));
}

function auditSensitive(value) {
  return value ? { present:true, last4:String(value).replace(/\s+/g,'').slice(-4) } : { present:false };
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
    roles: request.method === 'POST' ? ['SUPER_ADMIN', 'PAYROLL_PROCESSOR'] : ROLES,
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
    if (!hasD1(env)) return respond({ status:'error', message:'Layanan data karyawan belum tersedia. Hubungi administrator.', code:'EMPLOYEE_DATA_UNAVAILABLE', requestId }, 503);
    const database = env.DB;
    const actor = authorization.actor;
    const organizationId = String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
    if (request.method === 'POST' && !actor.permissions?.includes('employees:write')) {
      return respond({ error: 'Aksi ini membutuhkan izin employees:write', code: 'EMPLOYEES_WRITE_PERMISSION_REQUIRED' }, 403);
    }

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
        WHERE e.org_id=?${clientFilter}${projectFilter}
        ORDER BY e.name ASC
        LIMIT 500
      `, [organizationId, ...(actor.role === 'CLIENT_USER' ? scopedClientIds : []), ...(actor.role === 'CLIENT_USER' && scopedProjectIds?.length ? scopedProjectIds : [])]);
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
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return respond({ status: 'error', message: 'Invalid employee payload' }, 400);
      }

      const requestedId = String(body.id || '').trim();
      const existing = requestedId
        ? await d1First(database, 'SELECT * FROM employees WHERE id=? AND org_id=? LIMIT 1', [requestedId, organizationId])
        : null;
      const before = existing ? await d1First(database, `SELECT e.client_id,e.project_id,e.branch_id,e.location_id,e.employee_code,e.name,e.status_aktif,e.province,e.email,
          cp.basic_salary,
          (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 ORDER BY created_at DESC LIMIT 1) AS bank_name,
          (SELECT account_no FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 ORDER BY created_at DESC LIMIT 1) AS account_no,
          ei.ktp_no,ei.npwp_no,ei.address,bp.bpjs_kesehatan_no,bp.jamsostek_no
        FROM employees e
        LEFT JOIN employee_compensation cp ON cp.employee_id=e.id
        LEFT JOIN employee_identity ei ON ei.employee_id=e.id
        LEFT JOIN employee_bpjs bp ON bp.employee_id=e.id
        WHERE e.id=? AND e.org_id=? LIMIT 1`, [requestedId, organizationId]) : null;
      if (requestedId && !existing) {
        const foreign = await d1First(database, 'SELECT org_id FROM employees WHERE id=? LIMIT 1', [requestedId]);
        if (foreign) return respond({ error: 'Karyawan berada di luar organization aktif', code: 'EMPLOYEE_ORG_SCOPE_DENIED' }, 403);
      }

      const creating = !existing;
      if (creating && (!body.name || !String(body.name).trim())) {
        return respond({ status: 'error', message: 'name required' }, 400);
      }

      const id = existing?.id || requestedId || `EMP-${crypto.randomUUID()}`;
      const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
      const supplied = (...keys) => keys.some((key) => has(key));
      const value = (...keys) => {
        for (const key of keys) if (has(key)) return body[key];
        return undefined;
      };

      const currentClientId = existing?.client_id || null;
      const currentProjectId = existing?.project_id || null;
      const targetClientId = supplied('clientId','client_id') ? (value('clientId','client_id') || null) : currentClientId;
      const targetProjectId = supplied('projectId','project_id') ? (value('projectId','project_id') || null) : currentProjectId;
      const targetBranchId = supplied('branchId','branch_id') ? (value('branchId','branch_id') || null) : (existing?.branch_id || null);
      const targetLocationId = supplied('locationId','location_id') ? (value('locationId','location_id') || null) : (existing?.location_id || null);
      const targetName = supplied('name') ? String(body.name || '').trim() : String(existing?.name || '');
      const targetStatus = supplied('statusAktif','status_aktif','status')
        ? String(value('statusAktif','status_aktif','status') || '').trim()
        : String(existing?.status_aktif || 'TETAP');
      const targetProvince = supplied('province','region') ? (value('province','region') || null) : (existing?.province || null);
      const targetEmployeeCode = supplied('employeeCode','employee_code')
        ? String(value('employeeCode','employee_code') || '').trim()
        : String(existing?.employee_code || (String(id).startsWith('EMP-') ? id : `EMP-${id}`));

      if (!targetName || targetName.length > 160) return respond({ error:'Nama karyawan tidak valid', code:'EMPLOYEE_NAME_INVALID' },422);
      if (!targetEmployeeCode || targetEmployeeCode.length > 80 || !/^[A-Za-z0-9._\/-]+$/.test(targetEmployeeCode)) {
        return respond({ error:'Kode karyawan tidak valid', code:'EMPLOYEE_CODE_INVALID' },422);
      }
      if (has('email') && !validEmail(body.email)) return respond({ error:'Format email tidak valid', code:'EMPLOYEE_EMAIL_INVALID' },422);
      if (has('nik')) {
        const normalized=digits(body.nik);
        if (body.nik && normalized.length!==16) return respond({ error:'NIK harus terdiri dari 16 digit', code:'EMPLOYEE_NIK_INVALID' },422);
        body.nik=normalized || null;
      }
      if (has('npwp')) {
        const normalized=digits(body.npwp);
        if (body.npwp && ![15,16].includes(normalized.length)) return respond({ error:'NPWP harus terdiri dari 15 atau 16 digit', code:'EMPLOYEE_NPWP_INVALID' },422);
        body.npwp=normalized || null;
      }
      if (supplied('accountNo','bankAccount','bank_account')) {
        const raw=value('accountNo','bankAccount','bank_account');
        const normalized=digits(raw);
        if (raw && (normalized.length<6 || normalized.length>34)) return respond({ error:'Nomor rekening harus 6–34 digit', code:'EMPLOYEE_BANK_ACCOUNT_INVALID' },422);
        if (has('accountNo')) body.accountNo=normalized || null;
        else if (has('bankAccount')) body.bankAccount=normalized || null;
        else body.bank_account=normalized || null;
      }
      if (has('bpjsKesehatanNo')) {
        const normalized=digits(body.bpjsKesehatanNo);
        if (body.bpjsKesehatanNo && normalized.length!==13) return respond({ error:'Nomor BPJS Kesehatan harus 13 digit', code:'EMPLOYEE_BPJS_HEALTH_INVALID' },422);
        body.bpjsKesehatanNo=normalized || null;
      }
      if (has('jamsostekNo')) {
        const normalized=digits(body.jamsostekNo);
        if (body.jamsostekNo && normalized.length!==11) return respond({ error:'Nomor BPJS Ketenagakerjaan harus 11 digit', code:'EMPLOYEE_BPJS_WORK_INVALID' },422);
        body.jamsostekNo=normalized || null;
      }

      if (!targetName) return respond({ error: 'name required' }, 400);
      if (creating && !targetClientId) return respond({ error: 'clientId required', code: 'EMPLOYEE_CLIENT_REQUIRED' }, 422);

      const client = targetClientId
        ? await d1First(database, 'SELECT id FROM clients WHERE id=? AND org_id=? LIMIT 1', [targetClientId, organizationId])
        : null;
      if (targetClientId && !client) return respond({ error: 'Client tidak berada pada organization aktif', code: 'EMPLOYEE_CLIENT_SCOPE_INVALID' }, 422);
      if (targetProjectId) {
        const project = await d1First(database, 'SELECT id,client_id FROM projects WHERE id=? AND org_id=? LIMIT 1', [targetProjectId, organizationId]);
        if (!project || String(project.client_id || '') !== String(targetClientId || '')) {
          return respond({ error: 'Project tidak valid untuk client dan organization aktif', code: 'EMPLOYEE_PROJECT_SCOPE_INVALID' }, 422);
        }
      }

      const operations = [];
      if (creating) {
        operations.push({
          statement: `INSERT INTO employees (
            id, org_id, client_id, project_id, branch_id, location_id, employee_code, name, status_aktif, province, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          bindings: [id, organizationId, targetClientId, targetProjectId, targetBranchId, targetLocationId, targetEmployeeCode, targetName, targetStatus, targetProvince],
        });
      } else {
        operations.push({
          statement: `UPDATE employees SET client_id=?,project_id=?,branch_id=?,location_id=?,employee_code=?,name=?,status_aktif=?,province=?,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,
          bindings: [targetClientId,targetProjectId,targetBranchId,targetLocationId,targetEmployeeCode,targetName,targetStatus,targetProvince,id,organizationId],
        });
      }

      if (supplied('salaryGross','salary_gross','basicSalary')) {
        const salaryGross = Number(value('salaryGross','salary_gross','basicSalary'));
        if (!Number.isSafeInteger(salaryGross) || salaryGross < 0 || salaryGross > 1_000_000_000_000) return respond({ error:'Nilai gaji pokok tidak valid', code:'EMPLOYEE_SALARY_INVALID' },422);
        operations.push({ statement: `INSERT INTO employee_compensation (employee_id, basic_salary) VALUES (?, ?)
          ON CONFLICT (employee_id) DO UPDATE SET basic_salary=excluded.basic_salary,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`, bindings: [id, salaryGross] });
      }

      if (supplied('position') && body.position) {
        const assignmentId = `ASG-${id}`;
        operations.push({ statement: `INSERT INTO employee_assignments (id, employee_id, position, is_current)
          VALUES (?, ?, ?, 1) ON CONFLICT (id) DO UPDATE SET position=excluded.position, is_current=1`,
          bindings: [assignmentId, id, body.position] });
      }

      if (supplied('accountNo','bankAccount','bank_account')) {
        const accountNo = value('accountNo','bankAccount','bank_account');
        if (accountNo) {
          const bankId = `BNK-${id}`;
          operations.push(
            { statement: 'UPDATE employee_bank_accounts SET is_primary=0 WHERE employee_id=? AND id<>?', bindings: [id, bankId] },
            { statement: `INSERT INTO employee_bank_accounts (id, employee_id, bank_name, account_no, is_primary)
              VALUES (?, ?, ?, ?, 1) ON CONFLICT (id) DO UPDATE SET bank_name=excluded.bank_name,
              account_no=excluded.account_no, is_primary=1`, bindings: [bankId, id, supplied('bankName') ? body.bankName || null : before?.bank_name || 'UNKNOWN', accountNo] }
          );
        }
      }

      if (supplied('nik','npwp','address')) {
        operations.push({ statement: `INSERT INTO employee_identity (employee_id, ktp_no, npwp_no, address)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (employee_id) DO UPDATE SET
            ktp_no=CASE WHEN ? THEN EXCLUDED.ktp_no ELSE employee_identity.ktp_no END,
            npwp_no=CASE WHEN ? THEN EXCLUDED.npwp_no ELSE employee_identity.npwp_no END,
            address=CASE WHEN ? THEN EXCLUDED.address ELSE employee_identity.address END`,
          bindings: [id, has('nik') ? body.nik || null : null, has('npwp') ? body.npwp || null : null, has('address') ? body.address || null : null,
            has('nik') ? 1 : 0, has('npwp') ? 1 : 0, has('address') ? 1 : 0] });
      }
      if (supplied('bpjsKesehatanNo','jamsostekNo')) {
        operations.push({ statement: `INSERT INTO employee_bpjs (employee_id, bpjs_kesehatan_no, jamsostek_no)
          VALUES (?, ?, ?)
          ON CONFLICT (employee_id) DO UPDATE SET
            bpjs_kesehatan_no=CASE WHEN ? THEN EXCLUDED.bpjs_kesehatan_no ELSE employee_bpjs.bpjs_kesehatan_no END,
            jamsostek_no=CASE WHEN ? THEN EXCLUDED.jamsostek_no ELSE employee_bpjs.jamsostek_no END,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
          bindings: [id, has('bpjsKesehatanNo') ? body.bpjsKesehatanNo || null : null, has('jamsostekNo') ? body.jamsostekNo || null : null,
            has('bpjsKesehatanNo') ? 1 : 0, has('jamsostekNo') ? 1 : 0] });
      }
      if (supplied('email')) {
        operations.push({ statement: `UPDATE employees SET email=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,
          bindings: [body.email || null, id, organizationId] });
      }

      const changedFields=[];
      const auditBefore={};
      const auditAfter={};
      const track=(field,beforeValue,afterValue,{sensitive=false}={})=>{
        if (String(beforeValue ?? '')===String(afterValue ?? '')) return;
        changedFields.push(field);
        auditBefore[field]=sensitive?auditSensitive(beforeValue):beforeValue ?? null;
        auditAfter[field]=sensitive?auditSensitive(afterValue):afterValue ?? null;
      };
      track('clientId',before?.client_id,targetClientId);
      track('projectId',before?.project_id,targetProjectId);
      track('employeeCode',before?.employee_code,targetEmployeeCode);
      track('name',before?.name,targetName);
      track('status',before?.status_aktif,targetStatus);
      track('province',before?.province,targetProvince);
      if (has('email')) track('email',before?.email,body.email,{sensitive:true});
      if (supplied('salaryGross','salary_gross','basicSalary')) track('salaryGross',before?.basic_salary,Number(value('salaryGross','salary_gross','basicSalary')));
      if (has('nik')) track('nik',before?.ktp_no,body.nik,{sensitive:true});
      if (has('npwp')) track('npwp',before?.npwp_no,body.npwp,{sensitive:true});
      if (has('address')) track('address',before?.address,body.address,{sensitive:true});
      if (supplied('accountNo','bankAccount','bank_account')) track('accountNo',before?.account_no,value('accountNo','bankAccount','bank_account'),{sensitive:true});
      if (has('bankName')) track('bankName',before?.bank_name,body.bankName);
      if (has('bpjsKesehatanNo')) track('bpjsKesehatanNo',before?.bpjs_kesehatan_no,body.bpjsKesehatanNo,{sensitive:true});
      if (has('jamsostekNo')) track('jamsostekNo',before?.jamsostek_no,body.jamsostekNo,{sensitive:true});
      operations.push({
        statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?, 'employee',?)`,
        bindings:[`AUD-${crypto.randomUUID()}`,organizationId,actor.email,actor.role,creating?'EMPLOYEE_CREATED':'EMPLOYEE_UPDATED',
          JSON.stringify({changedFields,before:auditBefore,after:auditAfter}),id],
      });

      await d1Batch(database, operations);
      return respond({ ok:true, id, created:creating, changedFields });
    }

    return respond({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
