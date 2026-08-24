import { d1All, d1Batch, d1First, d1Run, hasD1 } from './_d1.js';
import { validateImportRows } from './import-validation.js';
import { PAYROLL_TEMPLATE_VERSION, validatePayrollControlRows } from './payroll-upload-validation.js';
import { clientIdsFor, projectIdsFor, authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';
const ROLES = ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'CLIENT_USER'];
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BINDINGS = 90;

function safeName(value) {
  return String(value || 'payroll.xlsx').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120);
}
function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}
function normalizeAccount(value) { return String(value || '').replace(/\s+/g, ''); }
function normalizeBank(value) { return String(value || '').trim().toUpperCase(); }
async function sha256Hex(value) {
  const bytes = value instanceof ArrayBuffer ? value : new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function bulkInsertPayrollLines(rows) {
  const columns = ['id','submission_id','employee_id','employee_code','employee_name','employment_status','bank_name','account_last4','gross_amount','deduction_amount','net_amount','components','source','included','source_batch_id','source_row_no','source_row_hash'];
  const size = Math.max(1, Math.floor(MAX_BINDINGS / columns.length));
  return chunks(rows, size).map((group) => ({
    statement: `INSERT INTO payroll_run_lines (${columns.join(',')}) VALUES ${group.map(() => `(${columns.map(() => '?').join(',')})`).join(',')}`,
    bindings: group.flat(),
  }));
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'POST only' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ROLES, mutating: true, methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'payroll-upload', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED', requestId }, 503);
  const bucket = env.FILES;
  if (!bucket?.put || !bucket?.delete) return respond({ error: 'R2 binding FILES wajib untuk menyimpan source payroll asli', code: 'R2_REQUIRED', requestId }, 503);

  let batchId = null;
  let objectKey = null;
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.name) return respond({ error: 'File payroll asli wajib diunggah' }, 422);
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) return respond({ error: 'Ukuran file payroll maksimal 8 MB' }, 413);
    const rowsText = String(form.get('rows') || '');
    const contextText = String(form.get('context') || '');
    const sourceSheet = String(form.get('sourceSheet') || '01_PAYROLL_DATA').slice(0, 120);
    const rawRowCount = Number(form.get('rawRowCount') || 0);
    const templateVersion = String(form.get('templateVersion') || PAYROLL_TEMPLATE_VERSION).slice(0, 80);
    let rows; let context;
    try { rows = JSON.parse(rowsText); context = JSON.parse(contextText); } catch { return respond({ error: 'Payload rows/context tidak valid' }, 400); }
    if (!context?.submissionId || !context?.clientId || !context?.servicePlanId || !context?.tier || !context?.period) {
      return respond({ error: 'Context Pay Run lengkap wajib disertakan' }, 422);
    }

    const orgId = String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
    const submission = await d1First(env.DB, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? AND client_id=?
      AND COALESCE(project_id,'')=COALESCE(?,'') AND service_plan_id=? AND service_tier=? AND period=? LIMIT 1`,
    [String(context.submissionId), orgId, String(context.clientId), context.projectId || null, String(context.servicePlanId), String(context.tier), String(context.period)]);
    if (!submission) return respond({ error: 'Pay Run tujuan upload tidak ditemukan atau scope tidak cocok' }, 404);
    if (submission.source_mode !== 'UPLOAD_FINAL' || submission.state !== 'DRAFT' || submission.period_status === 'CLOSED') {
      return respond({ error: 'Upload final hanya diperbolehkan pada Pay Run UPLOAD_FINAL yang masih DRAFT dan OPEN' }, 409);
    }
    if (authorization.actor.role === 'CLIENT_USER') {
      const allowedClients = clientIdsFor(authorization.actor, env) || [];
      const allowedProjects = projectIdsFor(authorization.actor) || [];
      if (!allowedClients.includes(String(submission.client_id))) return respond({ error: 'Client scope denied' }, 403);
      if (allowedProjects.length && !allowedProjects.includes(String(submission.project_id || ''))) return respond({ error: 'Project scope denied' }, 403);
    }

    const baseValidation = validateImportRows(rows);
    if (!baseValidation.ok) return respond({ error: 'Import validation failed', issues: baseValidation.issues }, 422);
    const control = validatePayrollControlRows(baseValidation.rows);
    if (!control.ok) return respond({ error: 'Payroll control total validation failed', code: 'PAYROLL_CONTROL_TOTAL_INVALID', issues: control.issues, totals: control.totals }, 422);

    // A final payroll source may reference existing master data, but it must never mutate it.
    // Unknown employees or bank-account drift are blocking exceptions that must be resolved in master first.
    const master = new Map();
    for (const group of chunks(baseValidation.rows.map((row) => String(row.nrk)), 70)) {
      const found = await d1All(env.DB, `SELECT e.id,e.name,e.client_id,e.project_id,e.status_aktif,eba.bank_name,eba.account_no
        FROM employees e LEFT JOIN employee_bank_accounts eba ON eba.employee_id=e.id AND eba.is_primary=1
        WHERE e.org_id=? AND e.id IN (${group.map(() => '?').join(',')})`, [orgId, ...group]);
      found.forEach((row) => master.set(String(row.id), row));
    }
    const masterIssues = [];
    baseValidation.rows.forEach((row, index) => {
      const employee = master.get(String(row.nrk));
      if (!employee) { masterIssues.push({ row:index+1, field:'nrk', message:'Karyawan tidak ada di master. Tambahkan employee sebelum payroll.' }); return; }
      if (String(employee.client_id) !== String(submission.client_id) || String(employee.project_id || '') !== String(submission.project_id || '')) {
        masterIssues.push({ row:index+1, field:'scope', message:'Karyawan tidak terhubung ke client/project Pay Run ini.' });
      }
      if (!employee.bank_name || !employee.account_no) masterIssues.push({ row:index+1, field:'bank', message:'Rekening utama belum lengkap di master employee.' });
      else if (normalizeBank(employee.bank_name) !== normalizeBank(row.bank) || normalizeAccount(employee.account_no) !== normalizeAccount(row.accountNo)) {
        masterIssues.push({ row:index+1, field:'accountNo', message:'Rekening pada file berbeda dengan rekening utama master. Perbarui master melalui workflow terpisah.' });
      }
    });
    if (masterIssues.length) return respond({ error:'Payroll source tidak cocok dengan employee master', code:'PAYROLL_MASTER_MISMATCH', issues:masterIssues.slice(0,200) }, 409);

    const fileBytes = await file.arrayBuffer();
    const fileHash = await sha256Hex(fileBytes);
    const existing = await d1First(env.DB, `SELECT * FROM payroll_upload_batches WHERE org_id=? AND submission_id=? AND file_sha256=? LIMIT 1`, [orgId, String(context.submissionId), fileHash]);
    if (existing?.status === 'IMPORTED') return respond({ ok: true, batch: existing, totals: control.totals, idempotentReplay: true });

    batchId = existing?.id || `PUB-${crypto.randomUUID()}`;
    objectKey = existing?.r2_object_key || `payroll-source/${orgId}/${context.submissionId}/${batchId}-${safeName(file.name)}`;
    await bucket.put(objectKey, fileBytes, {
      httpMetadata: { contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      customMetadata: { originalName: safeName(file.name), submissionId: String(context.submissionId), sha256: fileHash, uploadedBy: authorization.actor.email },
    });

    const rowHashes = [];
    if (!existing) {
      await d1Run(env.DB, `INSERT INTO payroll_upload_batches
        (id,org_id,submission_id,original_filename,r2_object_key,file_sha256,template_version,uploaded_by,sheet_name,raw_row_count,accepted_row_count,rejected_row_count,source_total_gross,source_total_deduction,source_total_net,status,validation_summary)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [batchId, orgId, String(context.submissionId), safeName(file.name), objectKey, fileHash, templateVersion, authorization.actor.email,
        sourceSheet, Number.isFinite(rawRowCount) ? rawRowCount : baseValidation.rows.length, baseValidation.rows.length, 0,
        control.totals.gross, control.totals.deduction, control.totals.net, 'VALIDATED', JSON.stringify({ control: control.totals })]);
      const rowOps = [];
      for (let i = 0; i < baseValidation.rows.length; i += 1) {
        const normalized = baseValidation.rows[i];
        const raw = Array.isArray(rows) ? rows[i] : normalized;
        const rowHash = await sha256Hex(JSON.stringify(normalized));
        rowHashes.push(rowHash);
        rowOps.push({ statement: `INSERT INTO payroll_upload_rows(id,batch_id,row_no,employee_id,raw_payload,normalized_payload,validation_status,validation_errors,row_hash)
          VALUES(?,?,?,?,?,?,?,?,?)`, bindings: [`PUR-${crypto.randomUUID()}`, batchId, i + 1, String(normalized.nrk), JSON.stringify(raw), JSON.stringify(normalized), 'ACCEPTED', '[]', rowHash] });
      }
      for (let i = 0; i < rowOps.length; i += 40) await d1Batch(env.DB, rowOps.slice(i, i + 40));
    } else {
      const stored = await d1All(env.DB, 'SELECT row_no,row_hash FROM payroll_upload_rows WHERE batch_id=? ORDER BY row_no', [batchId]);
      stored.forEach((row) => { rowHashes[Number(row.row_no)-1] = row.row_hash; });
    }

    const lineRows = baseValidation.rows.map((row, index) => {
      const employee = master.get(String(row.nrk));
      return [`PRL-${crypto.randomUUID()}`, String(submission.id), String(row.nrk), `EMP-${String(row.nrk).replace(/[^a-zA-Z0-9]+/g,'-').slice(0,40)}`,
        row.name || employee?.name || String(row.nrk), row.statusAktif || employee?.status_aktif || 'ACTIVE', row.bank,
        normalizeAccount(row.accountNo).slice(-4), Number(row.grossPay), Number(row.totalDeductions), Number(row.netPay), JSON.stringify(row.payrollComponents || {}),
        'UPLOAD_FINAL', 1, batchId, index + 1, rowHashes[index]];
    });
    const operations = [
      { statement:'DELETE FROM payroll_exceptions WHERE submission_id=?', bindings:[submission.id] },
      { statement:'DELETE FROM submission_versions WHERE submission_id=?', bindings:[submission.id] },
      { statement:'DELETE FROM payroll_run_lines WHERE submission_id=?', bindings:[submission.id] },
      ...bulkInsertPayrollLines(lineRows),
      { statement:`UPDATE payroll_submissions SET input_status='READY',state='DRAFT',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, bindings:[submission.id] },
      { statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?,?,?)`,
        bindings:[`AUD-${crypto.randomUUID()}`,orgId,authorization.actor.email,authorization.actor.role,'PAYROLL_SOURCE_IMPORTED',JSON.stringify({batchId,fileSha256:fileHash,templateVersion,totals:control.totals}),'payroll_submission',submission.id] },
    ];
    await d1Batch(env.DB, operations);
    await d1Run(env.DB, `UPDATE payroll_upload_batches SET status='IMPORTED',accepted_row_count=?,rejected_row_count=0,validation_summary=? WHERE id=?`,
      [baseValidation.rows.length, JSON.stringify({ control: control.totals, submissionId: submission.id }), batchId]);

    return respond({ ok:true, total:baseValidation.rows.length, inserted:0, updated:baseValidation.rows.length, errors:0,
      batchId, fileSha256:fileHash, templateVersion, totals:control.totals, submissionId:submission.id }, 201);
  } catch (error) {
    if (batchId) {
      try { await d1Run(env.DB, `UPDATE payroll_upload_batches SET status='ERROR',validation_summary=? WHERE id=?`, [JSON.stringify({ error: String(error?.message || error), requestId }), batchId]); } catch {}
    } else if (objectKey) {
      try { await bucket.delete(objectKey); } catch {}
    }
    return respond(publicError(error, requestId), 500);
  }
}
