import { d1All, d1Batch, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';
const CONFIRMATION = 'HAPUS SEMUA DATA';
// IMMUTABLE_PAYMENT_HISTORY remains enforced everywhere except this explicitly
// confirmed, Super Admin-only full database lifecycle operation.
const GUARD_NAMES = ['payment_instruction_lines_immutable_update','payment_instruction_lines_immutable_delete','payroll_run_lines_locked_update','payroll_run_lines_locked_delete','trg_payroll_run_lines_no_update_after_final','trg_payroll_run_lines_no_delete_after_final','trg_payroll_upload_rows_immutable_update','trg_payroll_upload_rows_immutable_delete','trg_payroll_upload_batch_no_delete_imported','trg_payroll_upload_batch_no_rewrite_imported'];
const RESTORE_GUARDS = [
  `CREATE TRIGGER IF NOT EXISTS payment_instruction_lines_immutable_update BEFORE UPDATE ON payment_instruction_lines BEGIN SELECT RAISE(ABORT, 'Payment instruction snapshot is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS payment_instruction_lines_immutable_delete BEFORE DELETE ON payment_instruction_lines BEGIN SELECT RAISE(ABORT, 'Payment instruction snapshot is immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS payroll_run_lines_locked_update BEFORE UPDATE ON payroll_run_lines WHEN EXISTS (SELECT 1 FROM payroll_submissions s WHERE s.id=OLD.submission_id AND (s.period_status='CLOSED' OR s.state IN ('PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','COMPLETED'))) BEGIN SELECT RAISE(ABORT,'payroll run snapshot is locked'); END`,
  `CREATE TRIGGER IF NOT EXISTS payroll_run_lines_locked_delete BEFORE DELETE ON payroll_run_lines WHEN EXISTS (SELECT 1 FROM payroll_submissions s WHERE s.id=OLD.submission_id AND (s.period_status='CLOSED' OR s.state<>'DRAFT')) BEGIN SELECT RAISE(ABORT,'payroll run snapshot is locked'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_payroll_run_lines_no_update_after_final BEFORE UPDATE ON payroll_run_lines WHEN EXISTS (SELECT 1 FROM payroll_submissions s WHERE s.id=OLD.submission_id AND (s.period_status='CLOSED' OR s.state IN ('PAYROLL_FINALIZED','PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED'))) BEGIN SELECT RAISE(ABORT, 'FINAL_PAYROLL_SNAPSHOT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_payroll_run_lines_no_delete_after_final BEFORE DELETE ON payroll_run_lines WHEN EXISTS (SELECT 1 FROM payroll_submissions s WHERE s.id=OLD.submission_id AND (s.period_status='CLOSED' OR s.state IN ('PAYROLL_FINALIZED','PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED'))) BEGIN SELECT RAISE(ABORT, 'FINAL_PAYROLL_SNAPSHOT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_payroll_upload_rows_immutable_update BEFORE UPDATE ON payroll_upload_rows BEGIN SELECT RAISE(ABORT, 'PAYROLL_SOURCE_ROW_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_payroll_upload_rows_immutable_delete BEFORE DELETE ON payroll_upload_rows BEGIN SELECT RAISE(ABORT, 'PAYROLL_SOURCE_ROW_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_payroll_upload_batch_no_delete_imported BEFORE DELETE ON payroll_upload_batches WHEN OLD.status='IMPORTED' BEGIN SELECT RAISE(ABORT, 'IMPORTED_PAYROLL_SOURCE_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_payroll_upload_batch_no_rewrite_imported BEFORE UPDATE OF original_filename,r2_object_key,file_sha256,template_version,uploaded_by,uploaded_at,source_total_gross,source_total_deduction,source_total_net ON payroll_upload_batches WHEN OLD.status='IMPORTED' BEGIN SELECT RAISE(ABORT, 'IMPORTED_PAYROLL_SOURCE_IMMUTABLE'); END`,
];
const DELETE_TABLES = ['portal_login_attempts','employee_portal_sessions','employee_credentials','ewa_requests','ewa_policies','payroll_intake_missing_resolutions','employee_master_history','reconciliations','payment_proofs','payment_approvals','ar_payment_idempotency','ar_follow_ups','ar_payments','unapplied_cash','ar_monitor','invoices','invoice_sequences','payment_instruction_lines','payment_instructions','payroll_exceptions','payroll_bank_snapshots','payroll_run_lines','submission_versions','payroll_upload_rows','payroll_upload_batches','payroll_submissions','integration_sync_runs','integration_connections','billing_rules','client_service_plans','portal_ads','portal_settings','employee_education','employee_bpjs','employee_bank_accounts','employee_compensation','employee_assignments','employee_contracts','employee_identity','employee_hris_meta','employees','work_locations','branches','projects','clients','user_client_scopes','user_project_scopes','ida_messages','ida_memories','audit_logs'];

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ['SUPER_ADMIN'], mutating: true, methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'full-database-reset', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);
  let body;
  try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
  if (body?.confirmation !== CONFIRMATION) return respond({ error: `Konfirmasi wajib: ${CONFIRMATION}` }, 422);

  const requestId = crypto.randomUUID();
  try {
    const counts = {};
    for (const table of DELETE_TABLES) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
      counts[table] = Number(row?.count || 0);
    }
    const userCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM app_users WHERE id<>?').bind(authorization.actor.id).first();
    const fileRows = await d1All(env.DB, `SELECT uploaded_file_id AS object_key FROM payment_proofs UNION SELECT r2_object_key AS object_key FROM payroll_upload_batches`);
    await d1Batch(env.DB, [
      ...GUARD_NAMES.map((name) => ({ statement: `DROP TRIGGER IF EXISTS ${name}` })),
      ...DELETE_TABLES.map((table) => ({ statement: `DELETE FROM ${table}` })),
      { statement: 'DELETE FROM app_sessions WHERE user_id<>?', bindings: [authorization.actor.id] },
      { statement: 'DELETE FROM app_user_profiles WHERE user_id<>?', bindings: [authorization.actor.id] },
      { statement: 'DELETE FROM app_users WHERE id<>?', bindings: [authorization.actor.id] },
      ...RESTORE_GUARDS.map((statement) => ({ statement })),
      { statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?,?,?)`, bindings: [`AUD-RESET-${requestId}`, env.DEFAULT_ORG_ID || authorization.actor.orgId || 'ORG-OTSINDO', authorization.actor.email, authorization.actor.role, 'FULL_DATABASE_RESET', JSON.stringify({ requestId, deleted: counts }), 'organization', env.DEFAULT_ORG_ID || authorization.actor.orgId || 'ORG-OTSINDO'] },
    ]);
    let filesDeleted = 0;
    let filesFailed = 0;
    const bucket = env.FILES || env.PAYMENT_PROOFS;
    if (bucket?.delete) for (const row of fileRows) {
      if (!row.object_key) continue;
      try { await bucket.delete(String(row.object_key)); filesDeleted += 1; } catch { filesFailed += 1; }
    }
    return respond({ ok: true, atomicDatabaseReset: true, preserved: { organization: true, currentSuperAdmin: authorization.actor.email, schema: true, securityAudit: true }, deleted: { clients: counts.clients, employees: counts.employees, payrolls: counts.payroll_submissions, paymentInstructions: counts.payment_instructions, invoices: counts.invoices, users: Number(userCount?.count || 0), files: filesDeleted }, fileCleanup: filesFailed ? { status: 'PARTIAL', failed: filesFailed } : { status: 'COMPLETE' } });
  } catch (error) {
    return respond({ error: 'Reset database gagal; transaksi dibatalkan', ...publicError(error, requestId) }, 500);
  }
}
