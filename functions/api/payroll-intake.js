import { d1All, d1Batch, d1First, d1Run, hasD1 } from "./_d1.js";
import { validateImportRows } from "./import-validation.js";
import {
  PAYROLL_TEMPLATE_VERSION,
  validatePayrollControlRows,
} from "./payroll-upload-validation.js";
import {
  authorize,
  clientIdsFor,
  enforceRateLimit,
  handlePreflight,
  projectIdsFor,
  publicError,
  secureJson,
} from "./_security.js";

const METHODS = "POST, OPTIONS";
const ROLES = ["SUPER_ADMIN", "PAYROLL_PROCESSOR", "CLIENT_USER"];
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACTIVE_EXITS = new Set([
  "INACTIVE",
  "NONACTIVE",
  "NON-ACTIVE",
  "NON AKTIF",
  "NONAKTIF",
  "TIDAK AKTIF",
  "RESIGN",
  "RESIGNED",
  "TERMINATED",
  "KELUAR",
  "BERHENTI",
  "PHK",
  "PENSIUN",
  "MENINGGAL",
  "DECEASED",
  "OFF",
  "CANCELLED",
]);
const MASTER_FIELDS = [
  "name",
  "gender",
  "birthDate",
  "joinDate",
  "employmentType",
  "contractStart",
  "contractEnd",
  "position",
  "kotaUmk",
  "npwp",
  "ktp",
  "marital",
  "ptkpClaimed",
  "bpjsKes",
  "jamsostek",
  "bank",
  "accountNo",
  "basicSalary",
  "statusAktif",
];

function clean(value) {
  return value == null ? null : String(value).trim() || null;
}
function normalizeAccount(value) {
  return String(value || "").replace(/\s+/g, "");
}
function normalizeBank(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}
function safeName(value) {
  return String(value || "payroll.xlsx")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-120);
}
function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size)
    out.push(values.slice(i, i + size));
  return out;
}
async function sha256Hex(value) {
  const bytes =
    value instanceof ArrayBuffer
      ? value
      : new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function monthEnd(period) {
  const [year, month] = String(period).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function employeeCode(row) {
  return String(row.nrk || "").trim();
}
function incomingMaster(row) {
  return {
    name: clean(row.name),
    gender: clean(row.gender),
    birthDate: clean(row.birthDate),
    joinDate: clean(row.joinDate),
    employmentType: clean(row.employmentType || row.contractStatus),
    contractStart: clean(row.contractStart),
    contractEnd: clean(row.contractEnd),
    position: clean(row.position),
    kotaUmk: clean(row.kotaUmk),
    npwp: clean(row.npwp),
    ktp: clean(row.ktp),
    marital: clean(row.marital),
    ptkpClaimed: clean(row.ptkpClaimed),
    bpjsKes: clean(row.bpjsKes),
    jamsostek: clean(row.jamsostek),
    bank: clean(row.bank),
    accountNo: normalizeAccount(row.accountNo),
    basicSalary: Number(row.basicSalary || 0),
    statusAktif: clean(row.statusAktif || row.employmentType || "ACTIVE"),
  };
}
function currentMaster(row) {
  if (!row) return null;
  return {
    name: clean(row.name),
    gender: clean(row.gender),
    birthDate: clean(row.birth_date),
    joinDate: clean(row.join_date),
    employmentType: clean(row.employment_type || row.contract_status),
    contractStart: clean(row.contract_start),
    contractEnd: clean(row.contract_end),
    position: clean(row.position),
    kotaUmk: clean(row.city_umk),
    npwp: clean(row.npwp_no),
    ktp: clean(row.ktp_no),
    marital: clean(row.marital_status),
    ptkpClaimed: clean(row.ptkp_claimed),
    bpjsKes: clean(row.bpjs_kesehatan_no),
    jamsostek: clean(row.jamsostek_no),
    bank: clean(row.bank_name),
    accountNo: normalizeAccount(row.account_no),
    basicSalary: Number(row.basic_salary || 0),
    statusAktif: clean(row.status_aktif),
  };
}
function changedFields(before, after) {
  if (!before) return MASTER_FIELDS.slice();
  return MASTER_FIELDS.filter((field) => {
    if (field === "bank")
      return normalizeBank(before[field]) !== normalizeBank(after[field]);
    if (field === "accountNo")
      return normalizeAccount(before[field]) !== normalizeAccount(after[field]);
    return String(before[field] ?? "") !== String(after[field] ?? "");
  });
}
async function validateIntakeContext(db, orgId, context) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(context.period || "")))
    return { error: "Periode payroll tidak valid" };
  const project = await d1First(
    db,
    `SELECT p.id,p.client_id FROM projects p JOIN clients c ON c.id=p.client_id
    WHERE p.id=? AND p.client_id=? AND p.org_id=? AND p.status='ACTIVE' AND c.status='ACTIVE' LIMIT 1`,
    [context.projectId, context.clientId, orgId],
  );
  if (!project)
    return { error: "Client atau project tidak aktif/tidak konsisten" };
  const periodStart = `${context.period}-01`;
  const periodEnd = monthEnd(context.period);
  const plan = await d1First(
    db,
    `SELECT id,tier FROM client_service_plans WHERE id=? AND client_id=?
    AND (project_id IS NULL OR project_id=?) AND status='ACTIVE' AND effective_from<=?
    AND (effective_until IS NULL OR effective_until>=?) LIMIT 1`,
    [
      context.servicePlanId,
      context.clientId,
      context.projectId,
      periodEnd,
      periodStart,
    ],
  );
  if (!plan)
    return {
      error:
        "Service tier tidak aktif untuk client, project, dan periode yang dipilih",
    };
  return {
    context: {
      ...context,
      tier: plan.tier,
      paymentPeriod: context.period,
      paymentDate: `${context.period}-25`,
    },
  };
}
async function resolveSubmission(db, orgId, context, actor) {
  const existing = await d1First(
    db,
    `SELECT * FROM payroll_submissions WHERE org_id=? AND client_id=? AND COALESCE(project_id,'')=COALESCE(?,'')
    AND period=? AND run_type='REGULAR' AND state<>'CANCELLED' ORDER BY created_at DESC LIMIT 1`,
    [orgId, context.clientId, context.projectId || null, context.period],
  );
  if (existing) {
    if (
      existing.state !== "DRAFT" ||
      existing.period_status === "CLOSED" ||
      existing.input_status === "READY"
    )
      throw new Error("PAYROLL_PERIOD_ALREADY_CONFIRMED");
    return existing;
  }
  const id = `SUB-${crypto.randomUUID()}`;
  const paymentDate = context.paymentDate || `${context.period}-25`;
  await d1Run(
    db,
    `INSERT INTO payroll_submissions
    (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,created_by,run_type,source_mode,payment_date,input_status,period_status)
    VALUES(?,?,?,?,?,?,?,?,'DRAFT',?,'REGULAR','UPLOAD_FINAL',?,'PENDING','OPEN')`,
    [
      id,
      orgId,
      context.clientId,
      context.projectId || null,
      context.servicePlanId,
      context.tier,
      context.period,
      context.paymentPeriod || context.period,
      actor.email,
      paymentDate,
    ],
  );
  return d1First(db, "SELECT * FROM payroll_submissions WHERE id=?", [id]);
}
async function loadCurrentEmployees(db, orgId, clientId, projectId) {
  return d1All(
    db,
    `SELECT e.id,e.employee_code,e.name,e.gender,e.birth_date,e.status_aktif,e.client_id,e.project_id,
      i.ktp_no,i.npwp_no,i.marital_status,i.ptkp_claimed,
      c.employment_type,c.contract_status,c.join_date,c.contract_start,c.contract_end,
      a.position,wl.city_umk,
      ec.basic_salary,
      ba.bank_name,ba.account_no,
      bp.bpjs_kesehatan_no,bp.jamsostek_no
    FROM employees e
    LEFT JOIN employee_identity i ON i.employee_id=e.id
    LEFT JOIN employee_contracts c ON c.employee_id=e.id AND c.is_current=1
    LEFT JOIN employee_assignments a ON a.employee_id=e.id AND a.is_current=1
    LEFT JOIN work_locations wl ON wl.id=e.location_id
    LEFT JOIN employee_compensation ec ON ec.employee_id=e.id
    LEFT JOIN employee_bank_accounts ba ON ba.employee_id=e.id AND ba.is_primary=1
    LEFT JOIN employee_bpjs bp ON bp.employee_id=e.id
    WHERE e.org_id=? AND e.client_id=? AND COALESCE(e.project_id,'')=COALESCE(?,'') ORDER BY e.name`,
    [orgId, clientId, projectId || null],
  );
}
async function previewUpload(request, env, actor) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name)
    return { status: 422, data: { error: "File payroll wajib diunggah" } };
  if (file.size <= 0 || file.size > MAX_FILE_BYTES)
    return {
      status: 413,
      data: { error: "Ukuran file payroll maksimal 8 MB" },
    };
  let rows;
  let context;
  try {
    rows = JSON.parse(String(form.get("rows") || ""));
    context = JSON.parse(String(form.get("context") || ""));
  } catch {
    return { status: 400, data: { error: "Payload rows/context tidak valid" } };
  }
  if (
    !context?.clientId ||
    !context?.projectId ||
    !context?.period ||
    !context?.servicePlanId
  ) {
    return {
      status: 422,
      data: {
        error: "Client, project, periode, dan service tier wajib dipilih",
      },
    };
  }
  const orgId = String(env.DEFAULT_ORG_ID || "ORG-OTSINDO");
  if (actor.role === "CLIENT_USER") {
    const clients = clientIdsFor(actor, env) || [];
    const projects = projectIdsFor(actor) || [];
    if (!clients.includes(String(context.clientId)))
      return { status: 403, data: { error: "Client scope denied" } };
    if (projects.length && !projects.includes(String(context.projectId)))
      return { status: 403, data: { error: "Project scope denied" } };
  }
  const verified = await validateIntakeContext(env.DB, orgId, context);
  if (verified.error) return { status: 422, data: { error: verified.error } };
  context = verified.context;
  const base = validateImportRows(rows);
  if (!base.ok)
    return {
      status: 422,
      data: { error: "Import validation failed", issues: base.issues },
    };
  const control = validatePayrollControlRows(base.rows);
  if (!control.ok)
    return {
      status: 422,
      data: {
        error: "Payroll control total validation failed",
        code: "PAYROLL_CONTROL_TOTAL_INVALID",
        issues: control.issues,
        totals: control.totals,
      },
    };
  const rowScopeIssues = [];
  base.rows.forEach((row, index) => {
    if (
      row.clientCode &&
      String(row.clientCode).toUpperCase() !==
        String(context.clientCode || row.clientCode).toUpperCase()
    )
      rowScopeIssues.push({
        row: index + 1,
        field: "clientCode",
        message: "Kode klien pada file tidak konsisten dengan intake",
      });
    if (
      row.sourceSheet &&
      row.sourceSheet !== "PAYROLL_INPUT" &&
      row.sourceSheet !== "01_PAYROLL_DATA"
    )
      rowScopeIssues.push({
        row: index + 1,
        field: "sheet",
        message: `Gunakan sheet PAYROLL_INPUT/01_PAYROLL_DATA, bukan ${row.sourceSheet}`,
      });
  });
  if (rowScopeIssues.length)
    return {
      status: 422,
      data: {
        error: "Scope template tidak konsisten",
        issues: rowScopeIssues.slice(0, 100),
      },
    };
  const submission = await resolveSubmission(env.DB, orgId, context, actor);
  const prior = await d1First(
    env.DB,
    `SELECT * FROM payroll_upload_batches WHERE submission_id=? AND status IN ('REVIEW_REQUIRED','READY_TO_CONFIRM','IMPORTED') ORDER BY uploaded_at DESC LIMIT 1`,
    [submission.id],
  );
  const bytes = await file.arrayBuffer();
  const fileHash = await sha256Hex(bytes);
  if (prior) {
    if (prior.file_sha256 === fileHash) {
      let summary = {};
      try {
        summary = JSON.parse(prior.validation_summary || "{}");
      } catch {}
      return {
        status: 200,
        data: {
          ok: true,
          idempotentReplay: true,
          batchId: prior.id,
          submissionId: submission.id,
          status: prior.status,
          ...summary,
        },
      };
    }
    return {
      status: 409,
      data: {
        error:
          "Payroll periode ini sudah memiliki satu file intake. Gunakan file yang sama atau reset intake sebelum mengganti sumber.",
        code: "PAYROLL_INTAKE_ALREADY_EXISTS",
      },
    };
  }
  const current = await loadCurrentEmployees(
    env.DB,
    orgId,
    context.clientId,
    context.projectId,
  );
  const byCode = new Map(
    current.map((row) => [
      String(row.employee_code || row.id)
        .trim()
        .toUpperCase(),
      row,
    ]),
  );
  const incomingCodes = new Set();
  const changes = [];
  const newEmployees = [];
  base.rows.forEach((row, index) => {
    const code = employeeCode(row).toUpperCase();
    incomingCodes.add(code);
    const existing = byCode.get(code);
    const after = incomingMaster(row);
    const before = currentMaster(existing);
    const fields = changedFields(before, after);
    if (!existing)
      newEmployees.push({ row: index + 1, nrk: row.nrk, name: row.name });
    else if (fields.length)
      changes.push({
        row: index + 1,
        employeeId: existing.id,
        nrk: row.nrk,
        name: row.name,
        changedFields: fields,
        before,
        after,
      });
  });
  const missing = current
    .filter(
      (row) =>
        !ACTIVE_EXITS.has(String(row.status_aktif || "ACTIVE").toUpperCase()) &&
        !incomingCodes.has(
          String(row.employee_code || row.id)
            .trim()
            .toUpperCase(),
        ),
    )
    .map((row) => ({
      employeeId: row.id,
      nrk: row.employee_code || row.id,
      name: row.name,
      status: row.status_aktif || "ACTIVE",
    }));
  const batchId = `PUB-${crypto.randomUUID()}`;
  const objectKey = `payroll-source/${orgId}/${submission.id}/${batchId}-${safeName(file.name)}`;
  await env.FILES.put(objectKey, bytes, {
    httpMetadata: {
      contentType:
        file.type ||
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    customMetadata: {
      originalName: safeName(file.name),
      submissionId: submission.id,
      sha256: fileHash,
      uploadedBy: actor.email,
    },
  });
  const rowOps = [];
  for (let i = 0; i < base.rows.length; i += 1) {
    const rowHash = await sha256Hex(JSON.stringify(base.rows[i]));
    rowOps.push({
      statement: `INSERT INTO payroll_upload_rows(id,batch_id,row_no,employee_id,raw_payload,normalized_payload,validation_status,validation_errors,row_hash) VALUES(?,?,?,?,?,?,?,?,?)`,
      bindings: [
        `PUR-${crypto.randomUUID()}`,
        batchId,
        i + 1,
        null,
        JSON.stringify(rows[i] ?? base.rows[i]),
        JSON.stringify(base.rows[i]),
        "ACCEPTED",
        "[]",
        rowHash,
      ],
    });
  }
  const status = missing.length ? "REVIEW_REQUIRED" : "READY_TO_CONFIRM";
  const summary = {
    totals: control.totals,
    newEmployees,
    changes,
    missing,
    comparison: {
      matched: base.rows.length - newEmployees.length,
      new: newEmployees.length,
      changed: changes.length,
      missing: missing.length,
    },
  };
  await d1Run(
    env.DB,
    `INSERT INTO payroll_upload_batches(id,org_id,submission_id,original_filename,r2_object_key,file_sha256,template_version,uploaded_by,sheet_name,raw_row_count,accepted_row_count,rejected_row_count,source_total_gross,source_total_deduction,source_total_net,status,validation_summary)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      batchId,
      orgId,
      submission.id,
      safeName(file.name),
      objectKey,
      fileHash,
      String(form.get("templateVersion") || PAYROLL_TEMPLATE_VERSION),
      actor.email,
      String(form.get("sourceSheet") || "PAYROLL_INPUT"),
      Number(form.get("rawRowCount") || base.rows.length),
      base.rows.length,
      0,
      control.totals.gross,
      control.totals.deduction,
      control.totals.net,
      status,
      JSON.stringify(summary),
    ],
  );
  for (const group of chunks(rowOps, 35)) await d1Batch(env.DB, group);
  await d1Run(
    env.DB,
    `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?,?,?)`,
    [
      `AUD-${crypto.randomUUID()}`,
      orgId,
      actor.email,
      actor.role,
      "PAYROLL_INTAKE_UPLOADED",
      JSON.stringify({
        batchId,
        period: context.period,
        comparison: summary.comparison,
        totals: control.totals,
      }),
      "payroll_submission",
      submission.id,
    ],
  );
  return {
    status: 201,
    data: {
      ok: true,
      batchId,
      submissionId: submission.id,
      status,
      ...summary,
    },
  };
}
async function applyEmployee(db, orgId, submission, batchId, rowRecord, actor) {
  const row = JSON.parse(rowRecord.normalized_payload);
  const code = employeeCode(row);
  const after = incomingMaster(row);
  const employee = await d1First(
    db,
    "SELECT * FROM employees WHERE org_id=? AND UPPER(COALESCE(employee_code,id))=UPPER(?) LIMIT 1",
    [orgId, code],
  );
  const existingHistory = employee
    ? await d1First(
        db,
        `SELECT id FROM employee_master_history WHERE employee_id=? AND source_batch_id=? AND action IN ('CREATED','UPDATED','MISSING_RESOLUTION') LIMIT 1`,
        [employee.id, batchId],
      )
    : null;
  if (existingHistory) return employee.id;
  const before = employee
    ? currentMaster(
        (
          await loadCurrentEmployees(
            db,
            orgId,
            submission.client_id,
            submission.project_id,
          )
        ).find((item) => item.id === employee.id),
      )
    : null;
  const fields = changedFields(before, after);
  const employeeId = employee?.id || `EMP-${crypto.randomUUID()}`;
  const operations = [];
  if (!employee)
    operations.push({
      statement: `INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,gender,birth_date,status_aktif,province,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      bindings: [
        employeeId,
        orgId,
        submission.client_id,
        submission.project_id,
        code,
        after.name || code,
        after.gender,
        after.birthDate,
        after.statusAktif || "ACTIVE",
        row.province || null,
      ],
    });
  else
    operations.push({
      statement: `UPDATE employees SET client_id=?,project_id=?,employee_code=?,name=?,gender=?,birth_date=?,status_aktif=?,province=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      bindings: [
        submission.client_id,
        submission.project_id,
        code,
        after.name || employee.name,
        after.gender,
        after.birthDate,
        after.statusAktif || employee.status_aktif || "ACTIVE",
        row.province || employee.province || null,
        employeeId,
      ],
    });
  operations.push({
    statement: `INSERT INTO employee_identity(employee_id,ktp_no,npwp_no,address,marital_status,ptkp_claimed,ptkp_updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(employee_id) DO UPDATE SET ktp_no=excluded.ktp_no,npwp_no=excluded.npwp_no,address=excluded.address,marital_status=excluded.marital_status,ptkp_claimed=excluded.ptkp_claimed,ptkp_updated=excluded.ptkp_updated`,
    bindings: [
      employeeId,
      after.ktp,
      after.npwp,
      row.address || null,
      after.marital,
      after.ptkpClaimed,
      row.ptkpUpdated || null,
    ],
  });
  operations.push({
    statement: `UPDATE employee_contracts SET is_current=0 WHERE employee_id=? AND is_current=1`,
    bindings: [employeeId],
  });
  operations.push({
    statement: `INSERT INTO employee_contracts(id,employee_id,employment_type,contract_status,join_date,accepted_date,contract_start,contract_end,resign_date,resign_reason,candidate_source,is_current) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`,
    bindings: [
      `ECT-${crypto.randomUUID()}`,
      employeeId,
      after.employmentType,
      row.contractStatus || after.employmentType,
      after.joinDate,
      row.acceptedDate || null,
      after.contractStart,
      after.contractEnd,
      row.resignDate || null,
      row.resignReason || null,
      row.candidateSource || null,
    ],
  });
  operations.push({
    statement: `UPDATE employee_assignments SET is_current=0,effective_to=? WHERE employee_id=? AND is_current=1`,
    bindings: [monthEnd(submission.period), employeeId],
  });
  operations.push({
    statement: `INSERT INTO employee_assignments(id,employee_id,position,pic,hrbp,effective_from,is_current) VALUES(?,?,?,?,?,?,1)`,
    bindings: [
      `EAS-${crypto.randomUUID()}`,
      employeeId,
      after.position,
      row.pic || null,
      row.hrbp || null,
      `${submission.period}-01`,
    ],
  });
  operations.push({
    statement: `INSERT INTO employee_compensation(employee_id,basic_salary,salary_start,currency,payroll_source_period,imported_gross,imported_deduction,imported_net,payroll_components,updated_at) VALUES(?,?,?,'IDR',?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(employee_id) DO UPDATE SET basic_salary=excluded.basic_salary,salary_start=excluded.salary_start,payroll_source_period=excluded.payroll_source_period,imported_gross=excluded.imported_gross,imported_deduction=excluded.imported_deduction,imported_net=excluded.imported_net,payroll_components=excluded.payroll_components,updated_at=excluded.updated_at`,
    bindings: [
      employeeId,
      after.basicSalary,
      row.salaryStart || `${submission.period}-01`,
      submission.period,
      Number(row.grossPay),
      Number(row.totalDeductions),
      Number(row.netPay),
      JSON.stringify(row.payrollComponents || {}),
    ],
  });
  operations.push({
    statement: `UPDATE employee_bank_accounts SET is_primary=0 WHERE employee_id=? AND is_primary=1 AND (UPPER(bank_name)<>UPPER(?) OR account_no<>?)`,
    bindings: [employeeId, after.bank || "", after.accountNo || ""],
  });
  operations.push({
    statement: `INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) SELECT ?,?,?,?,1 WHERE ?<>'' AND ?<>'' AND NOT EXISTS(SELECT 1 FROM employee_bank_accounts WHERE employee_id=? AND is_primary=1 AND UPPER(bank_name)=UPPER(?) AND account_no=?)`,
    bindings: [
      `EBA-${crypto.randomUUID()}`,
      employeeId,
      after.bank || "",
      after.accountNo || "",
      after.bank || "",
      after.accountNo || "",
      employeeId,
      after.bank || "",
      after.accountNo || "",
    ],
  });
  operations.push({
    statement: `INSERT INTO employee_bpjs(employee_id,bpjs_kesehatan_no,bpjs_kesehatan_effective,jamsostek_no,updated_at) VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(employee_id) DO UPDATE SET bpjs_kesehatan_no=excluded.bpjs_kesehatan_no,bpjs_kesehatan_effective=excluded.bpjs_kesehatan_effective,jamsostek_no=excluded.jamsostek_no,updated_at=excluded.updated_at`,
    bindings: [
      employeeId,
      after.bpjsKes,
      row.bpjsKesEffective || null,
      after.jamsostek,
    ],
  });
  operations.push({
    statement: `INSERT INTO employee_master_history(id,org_id,employee_id,source_batch_id,payroll_period,action,before_json,after_json,changed_fields,changed_by) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    bindings: [
      `EMH-${crypto.randomUUID()}`,
      orgId,
      employeeId,
      batchId,
      submission.period,
      employee ? "UPDATED" : "CREATED",
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      JSON.stringify(fields),
      actor.email,
    ],
  });
  await d1Batch(db, operations);
  return employeeId;
}
async function confirmIntake(body, env, actor) {
  if (body?.action !== "CONFIRM")
    return {
      status: 422,
      data: { error: "action CONFIRM wajib untuk menyelesaikan intake" },
    };
  const batchId = String(body.batchId || "");
  if (!batchId) return { status: 422, data: { error: "batchId wajib diisi" } };
  const batch = await d1First(
    env.DB,
    "SELECT * FROM payroll_upload_batches WHERE id=? LIMIT 1",
    [batchId],
  );
  if (!batch)
    return { status: 404, data: { error: "Payroll intake tidak ditemukan" } };
  const submission = await d1First(
    env.DB,
    "SELECT * FROM payroll_submissions WHERE id=? LIMIT 1",
    [batch.submission_id],
  );
  if (!submission)
    return {
      status: 404,
      data: { error: "Pay Run untuk intake tidak ditemukan" },
    };
  if (actor.role === "CLIENT_USER") {
    const clients = clientIdsFor(actor, env) || [];
    const projects = projectIdsFor(actor) || [];
    if (
      !clients.includes(String(submission.client_id)) ||
      (projects.length &&
        !projects.includes(String(submission.project_id || "")))
    )
      return { status: 403, data: { error: "Scope denied" } };
  }
  if (batch.status === "IMPORTED")
    return {
      status: 200,
      data: {
        ok: true,
        idempotentReplay: true,
        batchId,
        submissionId: batch.submission_id,
      },
    };
  if (
    !["REVIEW_REQUIRED", "READY_TO_CONFIRM", "APPLYING"].includes(batch.status)
  )
    return {
      status: 409,
      data: {
        error: `Payroll intake berstatus ${batch.status} tidak dapat dikonfirmasi`,
      },
    };
  if (submission.state !== "DRAFT" || submission.period_status === "CLOSED")
    return {
      status: 409,
      data: { error: "Pay Run tidak lagi dapat menerima intake" },
    };
  let summary = {};
  try {
    summary = JSON.parse(batch.validation_summary || "{}");
  } catch {}
  const missing = Array.isArray(summary.missing) ? summary.missing : [];
  const resolutions = body.missingResolutions || {};
  const unresolved = missing.filter(
    (item) =>
      !["NO_PAY_THIS_PERIOD", "RESIGNED", "TRANSFERRED", "OTHER"].includes(
        String(
          resolutions[item.employeeId]?.resolution ||
            resolutions[item.employeeId] ||
            "",
        ),
      ),
  );
  if (unresolved.length)
    return {
      status: 422,
      data: {
        error: "Semua karyawan yang hilang dari periode ini harus dikonfirmasi",
        code: "MISSING_EMPLOYEE_RESOLUTION_REQUIRED",
        missing: unresolved,
      },
    };
  const missingNotes = missing.filter(
    (item) =>
      ["TRANSFERRED", "OTHER"].includes(
        String(resolutions[item.employeeId]?.resolution || ""),
      ) && !clean(resolutions[item.employeeId]?.note),
  );
  if (missingNotes.length)
    return {
      status: 422,
      data: {
        error:
          "Catatan wajib untuk karyawan yang dimutasi atau menggunakan alasan lainnya",
        code: "MISSING_EMPLOYEE_NOTE_REQUIRED",
        missing: missingNotes,
      },
    };
  await d1Run(
    env.DB,
    "UPDATE payroll_upload_batches SET status='APPLYING' WHERE id=?",
    [batchId],
  );
  for (const item of missing) {
    const value = resolutions[item.employeeId];
    const resolution = String(value?.resolution || value);
    const note = clean(value?.note);
    const prior = await d1First(
      env.DB,
      "SELECT id FROM payroll_intake_missing_resolutions WHERE batch_id=? AND employee_id=?",
      [batchId, item.employeeId],
    );
    if (!prior) {
      const beforeRow = (
        await loadCurrentEmployees(
          env.DB,
          batch.org_id,
          submission.client_id,
          submission.project_id,
        )
      ).find((row) => row.id === item.employeeId);
      const before = currentMaster(beforeRow);
      if (resolution === "RESIGNED")
        await d1Run(
          env.DB,
          "UPDATE employees SET status_aktif='RESIGN',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
          [item.employeeId],
        );
      await d1Batch(env.DB, [
        {
          statement: `INSERT INTO payroll_intake_missing_resolutions(id,batch_id,employee_id,resolution,note,resolved_by) VALUES(?,?,?,?,?,?)`,
          bindings: [
            `PMR-${crypto.randomUUID()}`,
            batchId,
            item.employeeId,
            resolution,
            note,
            actor.email,
          ],
        },
        {
          statement: `INSERT OR IGNORE INTO employee_master_history(id,org_id,employee_id,source_batch_id,payroll_period,action,before_json,after_json,changed_fields,changed_by) VALUES(?,?,?,?,?,'MISSING_RESOLUTION',?,?,?,?)`,
          bindings: [
            `EMH-${crypto.randomUUID()}`,
            batch.org_id,
            item.employeeId,
            batchId,
            submission.period,
            before ? JSON.stringify(before) : null,
            JSON.stringify({ ...before, missingResolution: resolution, note }),
            JSON.stringify(resolution === "RESIGNED" ? ["statusAktif"] : []),
            actor.email,
          ],
        },
      ]);
    }
  }
  const rows = await d1All(
    env.DB,
    "SELECT * FROM payroll_upload_rows WHERE batch_id=? ORDER BY row_no",
    [batchId],
  );
  const resolved = [];
  for (const rowRecord of rows)
    resolved.push({
      rowRecord,
      employeeId: await applyEmployee(
        env.DB,
        batch.org_id,
        submission,
        batchId,
        rowRecord,
        actor,
      ),
    });
  await d1Run(env.DB, "DELETE FROM payroll_run_lines WHERE submission_id=?", [
    submission.id,
  ]);
  const lineOps = [];
  for (const item of resolved) {
    const row = JSON.parse(item.rowRecord.normalized_payload);
    lineOps.push({
      statement: `INSERT INTO payroll_run_lines(id,submission_id,employee_id,employee_code,employee_name,employment_status,bank_name,account_last4,gross_amount,deduction_amount,net_amount,components,source,included,source_batch_id,source_row_no,source_row_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'DATA_INTAKE',1,?,?,?)`,
      bindings: [
        `PRL-${crypto.randomUUID()}`,
        submission.id,
        item.employeeId,
        employeeCode(row),
        row.name,
        String(row.statusAktif || row.employmentType || "ACTIVE"),
        row.bank,
        normalizeAccount(row.accountNo).slice(-4),
        Number(row.grossPay),
        Number(row.totalDeductions),
        Number(row.netPay),
        JSON.stringify(row.payrollComponents || {}),
        batchId,
        item.rowRecord.row_no,
        item.rowRecord.row_hash,
      ],
    });
  }
  for (const group of chunks(lineOps, 35)) await d1Batch(env.DB, group);
  const finalSummary = {
    ...summary,
    missingResolutions: Object.fromEntries(
      missing.map((item) => [item.employeeId, resolutions[item.employeeId]]),
    ),
    confirmedBy: actor.email,
    confirmedAt: new Date().toISOString(),
  };
  await d1Batch(env.DB, [
    {
      statement: `UPDATE payroll_submissions SET input_status='READY',source_mode='UPLOAD_FINAL',state='DRAFT',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      bindings: [submission.id],
    },
    {
      statement: `UPDATE payroll_upload_batches SET status='IMPORTED',validation_summary=? WHERE id=?`,
      bindings: [JSON.stringify(finalSummary), batchId],
    },
    {
      statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?,?,?)`,
      bindings: [
        `AUD-${crypto.randomUUID()}`,
        batch.org_id,
        actor.email,
        actor.role,
        "PAYROLL_INTAKE_CONFIRMED",
        JSON.stringify({
          batchId,
          period: submission.period,
          employees: rows.length,
          missing: missing.length,
          totals: summary.totals,
        }),
        "payroll_submission",
        submission.id,
      ],
    },
  ]);
  return {
    status: 200,
    data: {
      ok: true,
      batchId,
      submissionId: submission.id,
      payRunState: "DRAFT",
      inputStatus: "READY",
      employees: rows.length,
      totals: summary.totals,
    },
  };
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS")
    return handlePreflight(request, env, METHODS);
  if (request.method !== "POST")
    return secureJson({ error: "POST only" }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, {
    roles: ROLES,
    mutating: true,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    "payroll-intake",
    METHODS,
  );
  if (limited) return limited;
  const respond = (data, status = 200) =>
    secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  if (!hasD1(env))
    return respond(
      {
        error: "Cloudflare D1 binding unavailable",
        code: "D1_REQUIRED",
        requestId,
      },
      503,
    );
  if (!env.FILES?.put)
    return respond(
      {
        error: "R2 FILES binding wajib untuk payroll intake",
        code: "R2_REQUIRED",
        requestId,
      },
      503,
    );
  try {
    const contentType = request.headers.get("content-type") || "";
    const result = contentType.includes("multipart/form-data")
      ? await previewUpload(request, env, authorization.actor)
      : await confirmIntake(await request.json(), env, authorization.actor);
    return respond(result.data, result.status);
  } catch (error) {
    const message = String(error?.message || error);
    if (message === "PAYROLL_PERIOD_ALREADY_CONFIRMED")
      return respond(
        {
          error:
            "Payroll periode ini sudah dikonfirmasi dan tidak dapat di-upload ulang",
          code: message,
        },
        409,
      );
    return respond(publicError(error, requestId), 500);
  }
}
