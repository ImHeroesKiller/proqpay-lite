import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { handleD1OperatingModel } from './operating-model-d1.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER'];
const SNAPSHOT_ROLES = new Set(['SUPER_ADMIN', 'PAYROLL_PROCESSOR']);
const RECONCILIABLE_STATUSES = new Set(['PROOF_UPLOADED', 'RECONCILIATION', 'PAYMENT_EXCEPTION']);
const encoder = new TextEncoder();

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function normalizeAccount(value) { return String(value || '').replace(/\s+/g, ''); }
async function bankFingerprint(bankName, accountNo) {
  return sha256Hex(`${String(bankName || '').trim().toUpperCase()}|${normalizeAccount(accountNo)}`);
}

async function captureBankSnapshot(env, submissionId, { legacy = false } = {}) {
  const rows = await d1All(env.DB, `SELECT l.employee_id,l.account_last4,eba.bank_name,eba.account_no
    FROM payroll_run_lines l LEFT JOIN employee_bank_accounts eba ON eba.employee_id=l.employee_id AND eba.is_primary=1
    WHERE l.submission_id=? AND l.included=1 ORDER BY l.employee_id`, [submissionId]);
  if (!rows.length) throw new Error('BANK_SNAPSHOT_EMPTY');
  const invalid = rows.filter((row) => !row.bank_name || !/^\d{6,34}$/.test(normalizeAccount(row.account_no)));
  if (invalid.length) throw new Error(`BANK_SNAPSHOT_INVALID:${invalid.length}`);
  if (legacy) {
    const mismatched = rows.filter((row) => !row.account_last4 || normalizeAccount(row.account_no).slice(-4) !== String(row.account_last4));
    if (mismatched.length) throw new Error(`LEGACY_BANK_SNAPSHOT_MISMATCH:${mismatched.length}`);
  }
  const operations = [];
  for (const row of rows) {
    const account = normalizeAccount(row.account_no);
    const fingerprint = await bankFingerprint(row.bank_name, account);
    operations.push({
      statement: `INSERT INTO payroll_bank_snapshots
        (submission_id,employee_id,bank_name,account_last4,account_fingerprint,captured_at)
        VALUES (?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT(submission_id,employee_id) DO UPDATE SET
        bank_name=excluded.bank_name,account_last4=excluded.account_last4,
        account_fingerprint=excluded.account_fingerprint,captured_at=excluded.captured_at`,
      bindings: [submissionId, row.employee_id, String(row.bank_name), account.slice(-4), fingerprint],
    });
  }
  if (legacy) operations.push({
    statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
      VALUES(?,?,?,?,?,?,?,?)`,
    bindings: [`AUD-${crypto.randomUUID()}`, String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO'), 'system', 'SYSTEM',
      'LEGACY_BANK_SNAPSHOT_BACKFILLED', 'Full bank fingerprint captured after last-4 verification', 'payroll_submission', submissionId],
  });
  await d1Batch(env.DB, operations);
}

async function validateBankSnapshot(env, submissionId) {
  let snapshots;
  try {
    snapshots = await d1All(env.DB, `SELECT s.employee_id,s.account_fingerprint,eba.bank_name,eba.account_no
      FROM payroll_bank_snapshots s LEFT JOIN employee_bank_accounts eba ON eba.employee_id=s.employee_id AND eba.is_primary=1
      WHERE s.submission_id=? ORDER BY s.employee_id`, [submissionId]);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return { ok: false, legacy: true, migrationMissing: true };
    throw error;
  }
  if (!snapshots.length) return { ok: true, legacy: true };
  const changed = [];
  for (const row of snapshots) {
    if (!row.bank_name || !/^\d{6,34}$/.test(normalizeAccount(row.account_no))) { changed.push(row.employee_id); continue; }
    if (await bankFingerprint(row.bank_name, row.account_no) !== row.account_fingerprint) changed.push(row.employee_id);
  }
  return { ok: changed.length === 0, changed, legacy: false };
}

async function readPostBody(request) {
  if (request.method !== 'POST') return null;
  try { return await request.clone().json(); } catch { return null; }
}

async function guardSensitivePaymentActions(body, env) {
  if (!body) return null;
  if (body.action === 'GENERATE_PAYMENT_INSTRUCTION') {
    const submissionId = String(body.submissionId || '').trim();
    if (!submissionId) return { status: 422, data: { error: 'submissionId wajib diisi' } };
    let snapshot = await validateBankSnapshot(env, submissionId);
    if (snapshot.migrationMissing) return { status: 503, data: { error: 'Migration snapshot rekening belum terpasang', code: 'BANK_SNAPSHOT_SCHEMA_REQUIRED' } };
    if (snapshot.legacy) {
      try { await captureBankSnapshot(env, submissionId, { legacy: true }); }
      catch (error) {
        return { status: 409, data: {
          error: /MISMATCH/.test(String(error?.message || error))
            ? 'Rekening aktif tidak cocok dengan last-4 snapshot payroll legacy. PI diblokir; review rekening dan buat adjustment Pay Run.'
            : 'Snapshot rekening legacy tidak dapat dibackfill. PI diblokir sampai data rekening direview.',
          code: 'LEGACY_BANK_SNAPSHOT_REVIEW_REQUIRED',
        } };
      }
      snapshot = await validateBankSnapshot(env, submissionId);
    }
    if (!snapshot.ok) return { status: 409, data: {
      error: `${snapshot.changed.length} rekening berubah setelah payroll difinalisasi. Review dan finalisasi ulang sebelum membuat PI.`,
      code: 'BANK_SNAPSHOT_CHANGED',
    } };
  }
  if (body.action !== 'RECONCILE_PAYMENT') return null;
  const paymentInstructionId = String(body.paymentInstructionId || '').trim();
  if (!paymentInstructionId) return { status: 422, data: { error: 'paymentInstructionId wajib diisi' } };
  const payment = await d1First(env.DB, `SELECT pi.id,pi.status,
    COALESCE((SELECT COUNT(*) FROM payment_proofs pp WHERE pp.payment_instruction_id=pi.id),0) AS proof_count
    FROM payment_instructions pi WHERE pi.id=? AND pi.org_id=? LIMIT 1`,
  [paymentInstructionId, String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO')]);
  if (!payment) return { status: 404, data: { error: 'Payment instruction not found' } };
  if (payment.status === 'COMPLETED') {
    const reconciliation = await d1First(env.DB, 'SELECT * FROM reconciliations WHERE payment_instruction_id=? LIMIT 1', [payment.id]);
    return { status: 200, data: { ok: true, reconciliation, idempotentReplay: true } };
  }
  if (!RECONCILIABLE_STATUSES.has(String(payment.status || '').toUpperCase())) {
    return { status: 409, data: { error: `PI berstatus ${payment.status || 'UNKNOWN'} belum dapat direkonsiliasi` } };
  }
  if (Number(payment.proof_count || 0) <= 0) return { status: 409, data: { error: 'Bukti pembayaran belum tersedia untuk rekonsiliasi' } };
  return null;
}

async function validateSnapshotCapture(body, actor, env) {
  if (body?.action !== 'ADVANCE_PAY_RUN' || body?.command !== 'FINALIZE_PAYROLL') return null;
  if (!SNAPSHOT_ROLES.has(actor.role)) return { status: 403, data: { error: 'Hanya Payroll Processor yang dapat memfinalisasi payroll' } };
  const submissionId = String(body.submissionId || '').trim();
  const submission = await d1First(env.DB, 'SELECT id,state FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1',
    [submissionId, String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO')]);
  if (!submission) return { status: 404, data: { error: 'Pay Run tidak ditemukan' } };
  if (!['VALIDATED','STANDARDIZED'].includes(String(submission.state || '').toUpperCase())) return { status: 409, data: { error: `Pay Run berstatus ${submission.state} tidak dapat difinalisasi` } };
  try { await captureBankSnapshot(env, submissionId); }
  catch { return { status: 409, data: { error: 'Snapshot rekening gagal dikunci. Payroll belum difinalisasi; periksa rekening utama karyawan lalu coba lagi.', code: 'BANK_SNAPSHOT_FAILED' } }; }
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ROLES, mutating: request.method === 'POST', methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'operating-model', METHODS);
  if (limited) return limited;
  if (!hasD1(env)) return secureJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);
  const body = await readPostBody(request);
  const guarded = await guardSensitivePaymentActions(body, env);
  if (guarded) return secureJson(guarded.data, guarded.status, request, env, METHODS);
  const snapshotGuard = await validateSnapshotCapture(body, authorization.actor, env);
  if (snapshotGuard) return secureJson(snapshotGuard.data, snapshotGuard.status, request, env, METHODS);
  return handleD1OperatingModel(context, authorization.actor);
}
