import { authorize, handlePreflight, secureJson } from './_security.js';
import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN', 'PAYROLL_CONTROLLER'];
const EARLY_PI = new Set(['DRAFT','PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','REVISION_REQUIRED']);
const UNSAFE_PI = new Set(['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED']);
const RESETTABLE_STATES = new Set(['CONTROLLER_REVIEW','DATA_APPROVED','PAYROLL_FINALIZED','PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','REVISION_REQUIRED']);

function orgId(env) { return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }
function validId(value) { return /^[A-Za-z0-9._:-]{1,120}$/.test(String(value || '')); }

async function inspect(database, organizationId, submissionId) {
  const submission = await d1First(database, `SELECT s.id,s.org_id,s.client_id,s.project_id,s.period,s.state,s.input_status,s.period_status,
    c.name AS client_name,p.name AS project_name,
    (SELECT COUNT(*) FROM payroll_run_lines l WHERE l.submission_id=s.id AND l.included=1) AS payroll_lines,
    (SELECT COALESCE(SUM(l.net_amount),0) FROM payroll_run_lines l WHERE l.submission_id=s.id AND l.included=1) AS payroll_net
    FROM payroll_submissions s JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
    WHERE s.id=? AND s.org_id=? LIMIT 1`, [submissionId, organizationId]);
  if (!submission) return null;
  const instructions = await d1All(database, `SELECT id,document_no,status,expected_total,recipient_count,created_at
    FROM payment_instructions WHERE submission_id=? AND org_id=? ORDER BY created_at DESC`, [submissionId, organizationId]);
  const paymentInstructionIds = instructions.map((row) => row.id);
  let proofs = 0, reconciliations = 0, invoices = 0;
  if (paymentInstructionIds.length) {
    const marks = paymentInstructionIds.map(() => '?').join(',');
    proofs = Number((await d1First(database, `SELECT COUNT(*) AS count FROM payment_proofs WHERE payment_instruction_id IN (${marks})`, paymentInstructionIds))?.count || 0);
    reconciliations = Number((await d1First(database, `SELECT COUNT(*) AS count FROM reconciliations WHERE payment_instruction_id IN (${marks})`, paymentInstructionIds))?.count || 0);
    invoices = Number((await d1First(database, `SELECT COUNT(*) AS count FROM invoices WHERE payment_instruction_id IN (${marks})`, paymentInstructionIds))?.count || 0);
  }
  const unsafeInstructions = instructions.filter((row) => UNSAFE_PI.has(String(row.status || '').toUpperCase())).length;
  return {
    submission,
    instructions,
    downstream: { proofs, reconciliations, invoices, unsafeInstructions },
    canReset: RESETTABLE_STATES.has(String(submission.state || '').toUpperCase()) && proofs === 0 && reconciliations === 0 && invoices === 0 && unsafeInstructions === 0,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET','POST'].includes(request.method)) return secureJson({ error:'Method not allowed' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ROLES, mutating: request.method === 'POST', methods: METHODS });
  if (authorization.response) return authorization.response;
  if (!hasD1(env)) return secureJson({ error:'Cloudflare D1 binding unavailable', code:'D1_REQUIRED' }, 503, request, env, METHODS);
  const organizationId = orgId(env);

  if (request.method === 'GET') {
    const submissionId = new URL(request.url).searchParams.get('submissionId');
    if (submissionId) {
      if (!validId(submissionId)) return secureJson({ error:'submissionId tidak valid' }, 422, request, env, METHODS);
      const result = await inspect(env.DB, organizationId, submissionId);
      return secureJson(result ? { ok:true, ...result } : { error:'Pay Run tidak ditemukan' }, result ? 200 : 404, request, env, METHODS);
    }
    const rows = await d1All(env.DB, `SELECT s.id,s.period,s.state,s.client_id,c.name AS client_name,p.name AS project_name,
      (SELECT COUNT(*) FROM payroll_run_lines l WHERE l.submission_id=s.id AND l.included=1) AS payroll_lines,
      (SELECT COUNT(*) FROM payment_instructions pi WHERE pi.submission_id=s.id AND pi.status<>'REJECTED') AS active_pi_count
      FROM payroll_submissions s JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE s.org_id=? AND s.state IN ('CONTROLLER_REVIEW','DATA_APPROVED','PAYROLL_FINALIZED','PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','REVISION_REQUIRED')
      ORDER BY s.period DESC,s.updated_at DESC LIMIT 100`, [organizationId]);
    return secureJson({ ok:true, payRuns:rows }, 200, request, env, METHODS);
  }

  let body;
  try { body = await request.json(); } catch { return secureJson({ error:'Invalid JSON' }, 400, request, env, METHODS); }
  const submissionId = String(body.submissionId || '').trim();
  if (!validId(submissionId)) return secureJson({ error:'submissionId tidak valid' }, 422, request, env, METHODS);
  if (body.confirmation !== 'RESET PAY RUN WORKFLOW') return secureJson({ error:'Konfirmasi wajib: RESET PAY RUN WORKFLOW' }, 422, request, env, METHODS);
  const reason = String(body.reason || '').trim();
  if (reason.length < 10 || reason.length > 500) return secureJson({ error:'Alasan reset wajib 10-500 karakter' }, 422, request, env, METHODS);

  const before = await inspect(env.DB, organizationId, submissionId);
  if (!before) return secureJson({ error:'Pay Run tidak ditemukan' }, 404, request, env, METHODS);
  if (!before.canReset) return secureJson({
    error:'Pay Run tidak aman untuk di-reset karena sudah memiliki payment proof, reconciliation, invoice, atau PI pada tahap finansial lanjut.',
    code:'PAY_RUN_RESET_BLOCKED',
    downstream:before.downstream,
  }, 409, request, env, METHODS);

  const actor = authorization.actor;
  const operations = [];
  for (const pi of before.instructions) {
    if (EARLY_PI.has(String(pi.status || '').toUpperCase())) {
      operations.push({ statement:`UPDATE payment_instructions SET status='REJECTED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, bindings:[pi.id] });
    }
  }
  operations.push({
    statement:`UPDATE payroll_submissions SET state='CONTROLLER_REVIEW',controller_reviewed_at=NULL,controller_reviewed_by=NULL,controller_review_note=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,
    bindings:[submissionId, organizationId],
  });
  operations.push({
    statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?,?,?)`,
    bindings:[`AUD-${crypto.randomUUID()}`,organizationId,actor.email || actor.id || 'unknown',actor.role,'PAY_RUN_WORKFLOW_RESET',`${reason} · payroll snapshot preserved · early PI rejected`,'payroll_submission',submissionId],
  });
  await d1Batch(env.DB, operations);
  const after = await inspect(env.DB, organizationId, submissionId);
  return secureJson({ ok:true, reset:true, before:{ state:before.submission.state, activePI:before.instructions.filter((row)=>row.status!=='REJECTED').length }, after }, 200, request, env, METHODS);
}
