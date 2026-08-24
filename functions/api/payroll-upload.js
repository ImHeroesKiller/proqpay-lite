import { d1All, d1Batch, d1First, d1Run, hasD1 } from './_d1.js';
import { importRowsD1 } from './import-d1.js';
import { validateImportRows } from './import-validation.js';
import { PAYROLL_TEMPLATE_VERSION, validatePayrollControlRows } from './payroll-upload-validation.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';
const ROLES = ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'CLIENT_USER'];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function safeName(value) {
  return String(value || 'payroll.xlsx').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120);
}
async function sha256Hex(value) {
  const bytes = value instanceof ArrayBuffer ? value : new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

    const baseValidation = validateImportRows(rows);
    if (!baseValidation.ok) return respond({ error: 'Import validation failed', issues: baseValidation.issues }, 422);
    const control = validatePayrollControlRows(baseValidation.rows);
    if (!control.ok) return respond({ error: 'Payroll control total validation failed', code: 'PAYROLL_CONTROL_TOTAL_INVALID', issues: control.issues, totals: control.totals }, 422);

    const fileBytes = await file.arrayBuffer();
    const fileHash = await sha256Hex(fileBytes);
    const orgId = String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
    const existing = await d1First(env.DB, `SELECT * FROM payroll_upload_batches WHERE org_id=? AND submission_id=? AND file_sha256=? LIMIT 1`, [orgId, String(context.submissionId), fileHash]);
    if (existing?.status === 'IMPORTED') return respond({ ok: true, batch: existing, totals: control.totals, idempotentReplay: true });

    batchId = existing?.id || `PUB-${crypto.randomUUID()}`;
    objectKey = existing?.r2_object_key || `payroll-source/${orgId}/${context.submissionId}/${batchId}-${safeName(file.name)}`;
    await bucket.put(objectKey, fileBytes, {
      httpMetadata: { contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      customMetadata: { originalName: safeName(file.name), submissionId: String(context.submissionId), sha256: fileHash, uploadedBy: authorization.actor.email },
    });

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
        rowOps.push({ statement: `INSERT INTO payroll_upload_rows(id,batch_id,row_no,employee_id,raw_payload,normalized_payload,validation_status,validation_errors,row_hash)
          VALUES(?,?,?,?,?,?,?,?,?)`, bindings: [`PUR-${crypto.randomUUID()}`, batchId, i + 1, String(normalized.nrk), JSON.stringify(raw), JSON.stringify(normalized), 'ACCEPTED', '[]', rowHash] });
      }
      for (let i = 0; i < rowOps.length; i += 40) await d1Batch(env.DB, rowOps.slice(i, i + 40));
    }

    const result = await importRowsD1({
      env,
      actor: authorization.actor,
      body: { rows: baseValidation.rows, context },
      rows: baseValidation.rows,
      respond: (data, status = 200) => ({ data, status }),
      requestId,
    });
    if (!result || Number(result.status || 500) >= 400 || result.data?.error) {
      await d1Run(env.DB, `UPDATE payroll_upload_batches SET status='REJECTED',validation_summary=? WHERE id=?`, [JSON.stringify(result?.data || { error: 'Import failed' }), batchId]);
      return respond(result?.data || { error: 'Import payroll gagal' }, Number(result?.status || 500));
    }

    const rowLinks = await d1All(env.DB, 'SELECT employee_id,row_no,row_hash FROM payroll_upload_rows WHERE batch_id=?', [batchId]);
    const linkOps = rowLinks.map((row) => ({ statement: `UPDATE payroll_run_lines SET source_batch_id=?,source_row_no=?,source_row_hash=? WHERE submission_id=? AND employee_id=?`,
      bindings: [batchId, row.row_no, row.row_hash, String(context.submissionId), row.employee_id] }));
    for (let i = 0; i < linkOps.length; i += 40) await d1Batch(env.DB, linkOps.slice(i, i + 40));
    await d1Run(env.DB, `UPDATE payroll_upload_batches SET status='IMPORTED',accepted_row_count=?,rejected_row_count=0,validation_summary=? WHERE id=?`,
      [baseValidation.rows.length, JSON.stringify({ control: control.totals, import: result.data }), batchId]);

    return respond({ ...result.data, ok: true, batchId, fileSha256: fileHash, templateVersion, totals: control.totals }, 201);
  } catch (error) {
    if (batchId) {
      try { await d1Run(env.DB, `UPDATE payroll_upload_batches SET status='ERROR',validation_summary=? WHERE id=?`, [JSON.stringify({ error: String(error?.message || error), requestId }), batchId]); } catch {}
    } else if (objectKey) {
      try { await bucket.delete(objectKey); } catch {}
    }
    return respond(publicError(error, requestId), 500);
  }
}
