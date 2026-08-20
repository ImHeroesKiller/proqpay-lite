import { d1All, d1Batch, d1First } from './_d1.js';
import { handlePreflight, publicError, secureJson } from './_security.js';
import { canTransition, resolveTierTransition, validateOperatingAction } from './operating-model-validation.js';
import { canonicalBankCode, encryptAccountNumber, instructionContentHash, sha256Hex } from './payment-instruction-core.js';

const METHODS = 'GET, POST, OPTIONS';
const PROCESSOR_ROLES = new Set(['SUPER_ADMIN', 'PAYROLL_PROCESSOR']);
const CONTROLLER_ROLES = new Set(['SUPER_ADMIN', 'PAYROLL_CONTROLLER']);
const CLIENT_ROLES = new Set(['CLIENT_USER']);
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function orgId(env) {
  return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

function clientScope(actor, env) {
  if (actor.role !== 'CLIENT_USER') return null;
  if (Array.isArray(actor.clientIds)) return new Set(actor.clientIds.map(String));
  try {
    const map = JSON.parse(env.CLIENT_SCOPE_JSON || '{}');
    const value = map[String(actor.email || '').toLowerCase()];
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}

function assertClientScope(actor, env, clientId) {
  const scope = clientScope(actor, env);
  return !scope || scope.has(String(clientId));
}

function assertProjectScope(actor, projectId) {
  if (actor.role !== 'CLIENT_USER' || !Array.isArray(actor.projectIds) || !actor.projectIds.length) return true;
  return Boolean(projectId && actor.projectIds.map(String).includes(String(projectId)));
}

function roleAllowsTransition(role, from, to) {
  if (CLIENT_ROLES.has(role)) return (from === 'DRAFT' && to === 'SUBMITTED')
    || (from === 'CLIENT_ACTION_REQUIRED' && to === 'CLIENT_RESUBMITTED');
  if (CONTROLLER_ROLES.has(role)) {
    return ['CONTROLLER_REVIEW', 'DATA_APPROVED', 'PAYROLL_FINALIZED', 'PAYMENT_INSTRUCTION_READY',
      'PAYMENT_APPROVAL_PENDING', 'APPROVED_FOR_PAYMENT', 'DISBURSEMENT_PROCESSING',
      'PROOF_UPLOADED', 'RECONCILIATION', 'PAYMENT_EXCEPTION'].includes(from);
  }
  return PROCESSOR_ROLES.has(role);
}

async function parseBody(request) {
  if (Number(request.headers.get('content-length') || 0) > 2 * 1024 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
  return request.json();
}

function parseJsonFields(rows, fields) {
  return rows.map((row) => {
    for (const field of fields) {
      if (typeof row[field] === 'string') {
        try { row[field] = JSON.parse(row[field]); } catch { row[field] = field.includes('period') ? [] : {}; }
      }
    }
    return row;
  });
}

function scopeWhere({ organizationId, clientId, projectIds = [], orgColumn = 's.org_id', clientColumn = 's.client_id', projectColumn = 's.project_id' }) {
  const clauses = [`${orgColumn}=?`];
  const bindings = [organizationId];
  if (clientId) { clauses.push(`${clientColumn}=?`); bindings.push(clientId); }
  if (projectIds.length) {
    clauses.push(`${projectColumn} IN (${projectIds.map(() => '?').join(',')})`);
    bindings.push(...projectIds);
  }
  return { sql: clauses.join(' AND '), bindings };
}

const SUBMISSION_SELECT = `SELECT s.*, c.name AS client_name, p.name AS project_name,
  COALESCE((SELECT COUNT(*) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
    WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id)
      AND ec.payroll_source_period=s.period),0) AS employee_count,
  COALESCE((SELECT SUM(ec.imported_gross) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
    WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id)
      AND ec.payroll_source_period=s.period),0) AS total_gross,
  COALESCE((SELECT SUM(ec.imported_deduction) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
    WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id)
      AND ec.payroll_source_period=s.period),0) AS total_deduction,
  COALESCE((SELECT SUM(ec.imported_net) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
    WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id)
      AND ec.payroll_source_period=s.period),0) AS total_net,
  (SELECT COUNT(*) FROM payroll_exceptions pe WHERE pe.submission_id=s.id) AS exception_count,
  (SELECT COUNT(*) FROM payroll_exceptions pe WHERE pe.submission_id=s.id AND pe.severity='CRITICAL'
    AND pe.status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')) AS blocking_count
  FROM payroll_submissions s JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id`;

const PI_SELECT = `SELECT pi.*, s.period AS payroll_period, COALESCE(s.payment_period,s.period) AS payment_period,
  COALESCE(s.arrears_periods,'[]') AS arrears_periods, c.name AS client_name, p.name AS project_name
  FROM payment_instructions pi JOIN payroll_submissions s ON s.id=pi.submission_id
  JOIN clients c ON c.id=pi.client_id LEFT JOIN projects p ON p.id=s.project_id`;

async function readResource(database, params, actor, env, organizationId) {
  const resource = params.get('resource') || 'submissions';
  const clientId = params.get('clientId');
  const projectIds = actor.role === 'CLIENT_USER' && Array.isArray(actor.projectIds) ? actor.projectIds.map(String) : [];
  if (actor.role === 'CLIENT_USER' && (!clientId || !assertClientScope(actor, env, clientId))) {
    return { status: 403, data: { error: 'Client scope required' } };
  }
  const submissionScope = scopeWhere({ organizationId, clientId, projectIds });

  if (resource === 'service-plans') {
    const where = clientId ? 'sp.client_id=? AND c.org_id=?' : 'c.org_id=?';
    const bindings = clientId ? [clientId, organizationId] : [organizationId];
    const rows = await d1All(database, `SELECT sp.* FROM client_service_plans sp JOIN clients c ON c.id=sp.client_id
      WHERE ${where} ORDER BY sp.effective_from DESC LIMIT 100`, bindings);
    return { data: { ok: true, servicePlans: rows } };
  }

  if (resource === 'exceptions') {
    const rows = await d1All(database, `SELECT e.*, s.client_id, s.project_id, s.period, s.service_tier,
      c.name AS client_name, p.name AS project_name,
      (SELECT au.email FROM app_users au JOIN user_client_scopes ucs ON ucs.user_id=au.id
       WHERE ucs.client_id=s.client_id AND au.role='CLIENT_USER' AND au.status='ACTIVE'
       ORDER BY au.created_at LIMIT 1) AS client_email
      FROM payroll_exceptions e JOIN payroll_submissions s ON s.id=e.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${submissionScope.sql} ORDER BY e.created_at DESC LIMIT 2000`, submissionScope.bindings);
    return { data: { ok: true, exceptions: parseJsonFields(rows, ['source_value','canonical_value','suggested_value']) } };
  }

  if (resource === 'payment-instructions') {
    const scope = scopeWhere({ organizationId, clientId, orgColumn: 'pi.org_id', clientColumn: 'pi.client_id', projectIds, projectColumn: 's.project_id' });
    const rows = await d1All(database, `${PI_SELECT} WHERE ${scope.sql} ORDER BY pi.created_at DESC LIMIT 100`, scope.bindings);
    return { data: { ok: true, paymentInstructions: parseJsonFields(rows, ['arrears_periods']) } };
  }

  if (resource === 'payment-instruction-detail') {
    const paymentInstructionId = params.get('paymentInstructionId');
    if (!paymentInstructionId) return { status: 422, data: { error: 'paymentInstructionId wajib diisi' } };
    const instruction = await d1First(database, `SELECT pi.*, s.period AS payroll_period,
      COALESCE(s.payment_period,s.period) AS payment_period, c.name AS client_name, p.name AS project_name,
      maker.email AS creator_email FROM payment_instructions pi
      JOIN payroll_submissions s ON s.id=pi.submission_id JOIN clients c ON c.id=pi.client_id
      LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN app_users maker ON maker.id=pi.creator_user_id
      WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [paymentInstructionId, organizationId]);
    if (!instruction) return { status: 404, data: { error: 'Payment instruction tidak ditemukan' } };
    if (!assertClientScope(actor, env, instruction.client_id)) return { status: 403, data: { error: 'Client scope denied' } };
    const [lines, approvals] = await Promise.all([
      d1All(database, `SELECT id,employee_id,beneficiary_name,bank_name,bank_code,
        COALESCE(account_last4,substr(masked_account,-4)) AS account_last4,masked_account,amount,line_hash
        FROM payment_instruction_lines WHERE payment_instruction_id=? ORDER BY beneficiary_name,id LIMIT 5000`, [paymentInstructionId]),
      d1All(database, `SELECT pa.id,pa.status,pa.created_at,pa.action_hash,au.email AS approver_email
        FROM payment_approvals pa LEFT JOIN app_users au ON au.id=pa.approver_user_id
        WHERE pa.payment_instruction_id=? ORDER BY pa.created_at`, [paymentInstructionId]),
    ]);
    const total = lines.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return { data: { ok: true, paymentInstruction: instruction, lines, approvals,
      control: { recipientCount: lines.length, totalAmount: total, expectedTotal: Number(instruction.expected_total), balanced: total === Number(instruction.expected_total) } } };
  }

  if (resource === 'payment-proofs') {
    const scope = scopeWhere({ organizationId, clientId, orgColumn: 'pi.org_id', clientColumn: 'pi.client_id' });
    const rows = await d1All(database, `SELECT pp.id,pp.payment_instruction_id,pp.bank,pp.reference,
      pp.transaction_date,pp.amount,pp.created_at FROM payment_proofs pp
      JOIN payment_instructions pi ON pi.id=pp.payment_instruction_id WHERE ${scope.sql}
      ORDER BY pp.created_at DESC LIMIT 200`, scope.bindings);
    return { data: { ok: true, paymentProofs: rows } };
  }

  if (resource === 'reconciliations') {
    const scope = scopeWhere({ organizationId, clientId, orgColumn: 'pi.org_id', clientColumn: 'pi.client_id' });
    const rows = await d1All(database, `SELECT r.* FROM reconciliations r
      JOIN payment_instructions pi ON pi.id=r.payment_instruction_id WHERE ${scope.sql}
      ORDER BY r.created_at DESC LIMIT 200`, scope.bindings);
    return { data: { ok: true, reconciliations: rows } };
  }

  if (resource === 'integrations') {
    const scope = scopeWhere({ organizationId, clientId, orgColumn: 'org_id', clientColumn: 'client_id' });
    const rows = await d1All(database, `SELECT * FROM integration_connections WHERE ${scope.sql}
      ORDER BY created_at DESC LIMIT 100`, scope.bindings);
    return { data: { ok: true, integrations: parseJsonFields(rows, ['config']) } };
  }

  if (resource === 'payment-reports') {
    const scope = scopeWhere({ organizationId, clientId, orgColumn: 'pi.org_id', clientColumn: 'pi.client_id', projectIds, projectColumn: 's.project_id' });
    const rows = await d1All(database, `SELECT pi.id,pi.client_id,c.name AS client_name,s.project_id,p.name AS project_name,
      s.period AS payroll_period,COALESCE(s.payment_period,s.period) AS payment_period,
      COALESCE(s.arrears_periods,'[]') AS arrears_periods,pi.status,pi.expected_total,
      COALESCE((SELECT SUM(pp.amount) FROM payment_proofs pp WHERE pp.payment_instruction_id=pi.id),0) AS paid_total,
      (SELECT MAX(pp.transaction_date) FROM payment_proofs pp WHERE pp.payment_instruction_id=pi.id) AS payment_date,
      (SELECT pp.id FROM payment_proofs pp WHERE pp.payment_instruction_id=pi.id ORDER BY pp.created_at DESC LIMIT 1) AS proof_id,
      (SELECT r.status FROM reconciliations r WHERE r.payment_instruction_id=pi.id LIMIT 1) AS reconciliation_status,
      (SELECT r.difference FROM reconciliations r WHERE r.payment_instruction_id=pi.id LIMIT 1) AS difference,
      (SELECT COUNT(*) FROM payment_instruction_lines pil WHERE pil.payment_instruction_id=pi.id) AS employee_count,
      pi.created_at,pi.updated_at FROM payment_instructions pi JOIN payroll_submissions s ON s.id=pi.submission_id
      JOIN clients c ON c.id=pi.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${scope.sql} ORDER BY COALESCE(s.payment_period,s.period) DESC,pi.created_at DESC LIMIT 500`, scope.bindings);
    return { data: { ok: true, paymentReports: parseJsonFields(rows, ['arrears_periods']) } };
  }

  const submissions = await d1All(database, `${SUBMISSION_SELECT} WHERE ${submissionScope.sql}
    ORDER BY s.created_at DESC LIMIT 200`, submissionScope.bindings);
  parseJsonFields(submissions, ['arrears_periods']);
  if (resource !== 'dashboard') return { data: { ok: true, submissions } };
  const [exceptions, paymentInstructions, paymentProofs, reconciliations] = await Promise.all([
    readResource(database, new URLSearchParams({ resource: 'exceptions', ...(clientId ? { clientId } : {}) }), actor, env, organizationId),
    readResource(database, new URLSearchParams({ resource: 'payment-instructions', ...(clientId ? { clientId } : {}) }), actor, env, organizationId),
    readResource(database, new URLSearchParams({ resource: 'payment-proofs', ...(clientId ? { clientId } : {}) }), actor, env, organizationId),
    readResource(database, new URLSearchParams({ resource: 'reconciliations', ...(clientId ? { clientId } : {}) }), actor, env, organizationId),
  ]);
  return { data: { ok: true, submissions, exceptions: exceptions.data.exceptions,
    paymentInstructions: paymentInstructions.data.paymentInstructions,
    paymentProofs: paymentProofs.data.paymentProofs, reconciliations: reconciliations.data.reconciliations } };
}

function auditOperation(organizationId, actor, action, detail, entity, entityId) {
  return { statement: `INSERT INTO audit_logs (id,org_id,username,role,action,detail,entity,entity_id)
    VALUES (?,?,?,?,?,?,?,?)`, bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role, action, detail, entity, entityId] };
}

function lineInsertOperations(paymentInstructionId, lines) {
  const operations = [];
  for (let offset = 0; offset < lines.length; offset += 8) {
    const chunk = lines.slice(offset, offset + 8);
    const columns = '(id,payment_instruction_id,employee_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)';
    const values = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const bindings = chunk.flatMap((row) => [`PIL-${crypto.randomUUID()}`, paymentInstructionId, row.id, row.name,
      row.bank_name, row.bankCode, `****${row.encrypted.last4}`, row.encrypted.ciphertext,
      row.encrypted.iv, row.encrypted.last4, row.lineHash, Number(row.amount)]);
    operations.push({ statement: `INSERT INTO payment_instruction_lines ${columns} VALUES ${values}`, bindings });
  }
  return operations;
}

async function executeAction(database, body, actor, env, organizationId) {
  if (body.action === 'CREATE_SERVICE_PLAN') {
    if (!PROCESSOR_ROLES.has(actor.role)) return { status: 403, data: { error: 'Insufficient role' } };
    const client = await d1First(database, 'SELECT id FROM clients WHERE id=? AND org_id=? LIMIT 1', [body.clientId, organizationId]);
    if (!client) return { status: 404, data: { error: 'Client not found' } };
    const overlap = await d1First(database, `SELECT id FROM client_service_plans WHERE client_id=? AND status='ACTIVE'
      AND effective_from<=COALESCE(?,'9999-12-31') AND COALESCE(effective_until,'9999-12-31')>=? LIMIT 1`,
      [body.clientId, body.effectiveUntil || null, body.effectiveFrom]);
    if (overlap) return { status: 409, data: { error: 'Service plan effective period overlaps an active plan', conflictingPlanId: overlap.id } };
    const id = body.id || `SP-${crypto.randomUUID()}`;
    const row = await d1First(database, `INSERT INTO client_service_plans
      (id,client_id,tier,status,contract_reference,effective_from,effective_until,created_by)
      VALUES (?,?,?,'ACTIVE',?,?,?,?) RETURNING *`,
      [id, body.clientId, body.tier, body.contractReference || null, body.effectiveFrom, body.effectiveUntil || null, actor.email]);
    return { status: 201, data: { ok: true, servicePlan: row } };
  }

  if (body.action === 'CREATE_SUBMISSION') {
    if (!assertClientScope(actor, env, body.clientId)) return { status: 403, data: { error: 'Client scope denied' } };
    const plan = await d1First(database, `SELECT sp.* FROM client_service_plans sp JOIN clients c ON c.id=sp.client_id
      WHERE sp.id=? AND sp.client_id=? AND c.org_id=? AND sp.status='ACTIVE'
      AND sp.effective_from<=date('now') AND (sp.effective_until IS NULL OR sp.effective_until>=date('now')) LIMIT 1`,
      [body.servicePlanId, body.clientId, organizationId]);
    if (!plan) return { status: 409, data: { error: 'Active service plan not found' } };
    const id = body.id || `SUB-${crypto.randomUUID()}`;
    const row = await d1First(database, `INSERT INTO payroll_submissions
      (id,org_id,client_id,service_plan_id,service_tier,period,payment_period,state,created_by)
      VALUES (?,?,?,?,?,?,?,'DRAFT',?) RETURNING *`,
      [id, organizationId, body.clientId, body.servicePlanId, plan.tier, body.period, body.period, actor.email]);
    return { status: 201, data: { ok: true, submission: row } };
  }

  if (body.action === 'TRANSITION_SUBMISSION') {
    const submission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!submission) return { status: 404, data: { error: 'Submission not found' } };
    if (!assertClientScope(actor, env, submission.client_id) || !assertProjectScope(actor, submission.project_id)) return { status: 403, data: { error: 'Scope denied' } };
    const targetState = resolveTierTransition(submission.service_tier, submission.state, body.toState);
    if (!canTransition(submission.state, targetState)) return { status: 409, data: { error: `Invalid transition ${submission.state} → ${targetState}` } };
    if (submission.service_tier === 'TIER_1_PAYMENT_PROCESSING' && ['INGESTING','PAYROLL_FINALIZED'].includes(targetState)) {
      return { status: 409, data: { error: 'Tier 1 langsung menggunakan data final klien tanpa kalkulasi ulang' } };
    }
    if (!roleAllowsTransition(actor.role, submission.state, targetState)) return { status: 403, data: { error: 'Role cannot perform transition' } };
    const processorReview = submission.state === 'STANDARDIZED' && targetState === 'CONTROLLER_REVIEW';
    const controllerReview = submission.state === 'CONTROLLER_REVIEW' && targetState === 'DATA_APPROVED';
    if ((processorReview || controllerReview) && body.reviewConfirmed !== true) return { status: 409, data: { error: 'Preview dan konfirmasi review wajib dilakukan sebelum melanjutkan' } };
    if (['VALIDATED','DATA_APPROVED','PAYROLL_FINALIZED','APPROVED_FOR_PAYMENT'].includes(targetState)) {
      const blocking = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_exceptions WHERE submission_id=?
        AND severity='CRITICAL' AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`, [submission.id]);
      if (Number(blocking?.count || 0) > 0) return { status: 409, data: { error: 'Critical exceptions still open' } };
    }
    let update = `UPDATE payroll_submissions SET state=?,updated_at=${NOW}`;
    const bindings = [targetState];
    if (processorReview) { update += `,processor_reviewed_at=${NOW},processor_reviewed_by=?,processor_review_note=?`; bindings.push(actor.email, String(body.reviewNote || '').slice(0, 1000)); }
    if (controllerReview) { update += `,controller_reviewed_at=${NOW},controller_reviewed_by=?,controller_review_note=?`; bindings.push(actor.email, String(body.reviewNote || '').slice(0, 1000)); }
    update += ' WHERE id=? RETURNING *'; bindings.push(submission.id);
    const results = await d1Batch(database, [
      { statement: update, bindings },
      auditOperation(organizationId, actor, 'SUBMISSION_TRANSITION', `${submission.state} → ${targetState}`, 'payroll_submission', submission.id),
    ]);
    return { data: { ok: true, submission: results[0]?.results?.[0] } };
  }

  if (body.action === 'UPDATE_SUBMISSION_PERIODS') {
    const current = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!current) return { status: 404, data: { error: 'Submission not found' } };
    if (!assertClientScope(actor, env, current.client_id) || !assertProjectScope(actor, current.project_id)) return { status: 403, data: { error: 'Scope denied' } };
    if (['PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','COMPLETED'].includes(current.state)) {
      return { status: 409, data: { error: 'Periode pembayaran sudah terkunci pada tahap payment' } };
    }
    const arrears = [...new Set(body.arrearsPeriods.map(String))].filter((p) => p !== current.period && p !== body.paymentPeriod);
    const row = await d1First(database, `UPDATE payroll_submissions SET payment_period=?,arrears_periods=?,updated_at=${NOW}
      WHERE id=? RETURNING *`, [body.paymentPeriod, JSON.stringify(arrears), body.submissionId]);
    return { data: { ok: true, submission: row } };
  }

  if (body.action === 'GENERATE_PAYMENT_INSTRUCTION') {
    if (!CONTROLLER_ROLES.has(actor.role)) return { status: 403, data: { error: 'Insufficient role' } };
    const submission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!submission) return { status: 404, data: { error: 'Submission not found' } };
    if (submission.state !== 'PAYMENT_INSTRUCTION_READY') return { status: 409, data: { error: 'Submission belum siap dibuatkan payment instruction' } };
    const existing = await d1First(database, 'SELECT * FROM payment_instructions WHERE submission_id=? AND org_id=? LIMIT 1', [submission.id, organizationId]);
    if (existing) return { data: { ok: true, paymentInstruction: existing, idempotentReplay: true } };
    const source = await d1All(database, `SELECT e.id,e.name,COALESCE(ec.imported_net,0) AS amount,
      (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS bank_name,
      (SELECT account_no FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS account_no
      FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id WHERE e.client_id=?
      AND (? IS NULL OR e.project_id=?) AND ec.payroll_source_period=? ORDER BY e.name`,
      [submission.client_id, submission.project_id || null, submission.project_id || null, submission.period]);
    if (!source.length) return { status: 409, data: { error: 'Tidak ada data payroll final untuk periode submission' } };
    const invalid = source.filter((row) => Number(row.amount || 0) <= 0 || !row.bank_name || !row.account_no);
    if (invalid.length) return { status: 409, data: { error: `${invalid.length} karyawan belum memiliki THP atau rekening bank yang valid` } };
    if (!env.PI_ENCRYPTION_KEY || String(env.PI_ENCRYPTION_KEY).length < 32) return { status: 503, data: { error: 'PI_ENCRYPTION_KEY belum dikonfigurasi dengan aman' } };
    const expectedTotal = source.reduce((sum, row) => sum + Number(row.amount), 0);
    const id = `PI-${crypto.randomUUID()}`;
    const paymentPeriod = submission.payment_period || submission.period;
    const idempotencyKey = `PI-${submission.id}-${paymentPeriod}`.slice(0, 120);
    const snapshotLines = await Promise.all(source.map(async (row) => {
      const encrypted = await encryptAccountNumber(row.account_no, env.PI_ENCRYPTION_KEY);
      const bankCode = canonicalBankCode(row.bank_name);
      const lineHash = await sha256Hex(JSON.stringify({ employeeId: row.id, beneficiaryName: row.name,
        bankCode, accountNumber: String(row.account_no), amount: Number(row.amount) }));
      return { ...row, bankCode, encrypted, lineHash };
    }));
    const contentHash = await instructionContentHash({ organizationId, clientId: submission.client_id,
      submissionId: submission.id, payrollPeriod: submission.period, paymentPeriod }, source.map((row) => ({
      employeeId: row.id, beneficiaryName: row.name, bankName: row.bank_name,
      accountNumber: row.account_no, amount: Number(row.amount),
    })));
    const documentNo = `PI/${paymentPeriod.replace('-','')}/${contentHash.slice(0,10).toUpperCase()}`;
    await d1Batch(database, [
      { statement: `INSERT INTO payment_instructions
        (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,
         document_no,content_hash,currency,execution_date,recipient_count)
        VALUES (?,?,?,?,'PAYMENT_APPROVAL_PENDING',?,?,?,?,?,'IDR',?,?)`,
        bindings: [id, organizationId, submission.client_id, submission.id, expectedTotal, actor.id, idempotencyKey,
          documentNo, contentHash, `${paymentPeriod}-01`, snapshotLines.length] },
      ...lineInsertOperations(id, snapshotLines),
      { statement: `UPDATE payroll_submissions SET state='PAYMENT_APPROVAL_PENDING',updated_at=${NOW} WHERE id=?`, bindings: [submission.id] },
      auditOperation(organizationId, actor, 'PAYMENT_INSTRUCTION_CREATED', `${documentNo} · ${snapshotLines.length} penerima · ${contentHash}`, 'payment_instruction', id),
    ]);
    const paymentInstruction = await d1First(database, 'SELECT * FROM payment_instructions WHERE id=?', [id]);
    return { status: 201, data: { ok: true, paymentInstruction } };
  }

  if (body.action === 'CREATE_EXCEPTION') {
    if (!PROCESSOR_ROLES.has(actor.role)) return { status: 403, data: { error: 'Insufficient role' } };
    const submission = await d1First(database, 'SELECT id FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!submission) return { status: 404, data: { error: 'Submission not found' } };
    const id = body.id || `EXC-${crypto.randomUUID()}`;
    const row = await d1First(database, `INSERT INTO payroll_exceptions
      (id,submission_id,employee_id,field,category,severity,source_value,canonical_value,suggested_value,reason,confidence,owner,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'OPEN') RETURNING *`, [id, body.submissionId, body.employeeId || null,
      body.field || null, body.category, body.severity, JSON.stringify(body.sourceValue ?? null),
      JSON.stringify(body.canonicalValue ?? null), JSON.stringify(body.suggestedValue ?? null), body.reason || null,
      body.confidence ?? null, body.owner || actor.email]);
    return { status: 201, data: { ok: true, exception: row } };
  }

  if (body.action === 'CREATE_VALIDATION_BATCH') {
    const submission = await d1First(database, 'SELECT id,client_id FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!submission) return { status: 404, data: { error: 'Submission not found' } };
    if (!assertClientScope(actor, env, submission.client_id)) return { status: 403, data: { error: 'Client scope denied' } };
    const issues = (body.issues || []).filter((issue) => issue && ['CRITICAL','WARNING','INFO'].includes(issue.severity));
    await d1Batch(database, [
      ...issues.map((issue) => ({ statement: `INSERT INTO payroll_exceptions
        (id,submission_id,employee_id,field,category,severity,reason,owner,status) VALUES (?,?,?,?,?,?,?,'PAYROLL_PROCESSOR','OPEN')`,
        bindings: [`EXC-${crypto.randomUUID()}`, body.submissionId, issue.employeeId || null, issue.field || null,
          String(issue.category || 'VALIDATION').slice(0,120), issue.severity, String(issue.reason || '').slice(0,1000)] })),
      { statement: `UPDATE payroll_submissions SET state=?,updated_at=${NOW} WHERE id=?`,
        bindings: [issues.length ? 'EXCEPTION_FOUND' : 'VALIDATED', body.submissionId] },
    ]);
    return { status: 201, data: { ok: true, created: issues.length } };
  }

  if (body.action === 'REQUEST_CLIENT_ACTION' || body.action === 'ADD_EXCEPTION_NOTE' || body.action === 'RESOLVE_EXCEPTION') {
    const current = await d1First(database, `SELECT e.*,s.client_id,s.project_id FROM payroll_exceptions e
      JOIN payroll_submissions s ON s.id=e.submission_id WHERE e.id=? AND s.org_id=? LIMIT 1`,
      [body.exceptionId, organizationId]);
    if (!current) return { status: 404, data: { error: 'Exception not found' } };
    if (!assertClientScope(actor, env, current.client_id) || !assertProjectScope(actor, current.project_id)) return { status: 403, data: { error: 'Scope denied' } };
    let row;
    if (body.action === 'RESOLVE_EXCEPTION') {
      row = await d1First(database, `UPDATE payroll_exceptions SET status=?,resolution_note=?,resolved_at=${NOW},resolved_by=?
        WHERE id=? RETURNING *`, [body.status, body.resolutionNote, actor.email, body.exceptionId]);
    } else {
      const status = body.action === 'REQUEST_CLIENT_ACTION' ? 'CLIENT_ACTION_REQUIRED' : current.status;
      const owner = body.action === 'REQUEST_CLIENT_ACTION' ? 'CLIENT_USER' : current.owner;
      const note = `${current.resolution_note ? `${current.resolution_note}\n` : ''}[${new Date().toISOString()}] ${actor.email}: ${String(body.message).slice(0,1000)}`;
      row = await d1First(database, 'UPDATE payroll_exceptions SET status=?,owner=?,resolution_note=? WHERE id=? RETURNING *',
        [status, owner, note, body.exceptionId]);
    }
    return { data: { ok: true, exception: row } };
  }

  if (body.action === 'CREATE_PAYMENT_INSTRUCTION') {
    return { status: 410, data: { error: 'Workflow payment instruction lama telah dinonaktifkan',
      code: 'LEGACY_PI_WORKFLOW_DISABLED', replacementAction: 'GENERATE_PAYMENT_INSTRUCTION' } };
  }

  if (body.action === 'APPROVE_PAYMENT') {
    if (!actor.permissions?.includes('payment:approve')) return { status: 403, data: { error: 'PAYMENT_APPROVER permission required' } };
    const payment = await d1First(database, `SELECT pi.*,
      COALESCE((SELECT SUM(amount) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id),0) AS instruction_total
      FROM payment_instructions pi WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [body.paymentInstructionId, organizationId]);
    if (!payment) return { status: 404, data: { error: 'Payment instruction not found' } };
    if (String(payment.creator_user_id) === String(actor.id)) return { status: 409, data: { error: 'Maker cannot approve the same payment instruction' } };
    if (Number(payment.instruction_total) !== Number(payment.expected_total)) return { status: 409, data: { error: 'Payment total mismatch blocks approval' } };
    if (!payment.content_hash || body.actionHash !== payment.content_hash) return { status: 409, data: { error: 'Content hash payment berubah atau tidak sesuai preview' } };
    const existing = await d1First(database, 'SELECT * FROM payment_approvals WHERE payment_instruction_id=? AND action_hash=? LIMIT 1', [payment.id, body.actionHash]);
    if (existing) return { data: { ok: true, approval: existing, idempotentReplay: true } };
    const approvalId = `PA-${crypto.randomUUID()}`;
    await d1Batch(database, [
      { statement: `INSERT INTO payment_approvals (id,payment_instruction_id,approver_user_id,status,action_hash)
        VALUES (?,?,?,'APPROVED',?)`, bindings: [approvalId, payment.id, actor.id, body.actionHash] },
      { statement: `UPDATE payment_instructions SET status='APPROVED_FOR_PAYMENT',updated_at=${NOW} WHERE id=?`, bindings: [payment.id] },
      { statement: `UPDATE payroll_submissions SET state='APPROVED_FOR_PAYMENT',updated_at=${NOW} WHERE id=?`, bindings: [payment.submission_id] },
      auditOperation(organizationId, actor, 'PAYMENT_APPROVED', 'Maker-checker approval passed', 'payment_instruction', payment.id),
    ]);
    return { data: { ok: true, approval: { id: approvalId, paymentInstructionId: payment.id, status: 'APPROVED' } } };
  }

  if (body.action === 'UPLOAD_PAYMENT_PROOF') return { status: 409, data: { error: 'Use /api/payment-proof multipart upload so evidence is stored in R2' } };

  if (body.action === 'RECONCILE_PAYMENT') {
    if (!CONTROLLER_ROLES.has(actor.role)) return { status: 403, data: { error: 'Insufficient role' } };
    const payment = await d1First(database, `SELECT pi.id,pi.submission_id,pi.expected_total,
      COALESCE((SELECT SUM(amount) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id),0) AS instruction_total,
      COALESCE((SELECT SUM(amount) FROM payment_proofs WHERE payment_instruction_id=pi.id),0) AS proof_total
      FROM payment_instructions pi WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [body.paymentInstructionId, organizationId]);
    if (!payment) return { status: 404, data: { error: 'Payment instruction not found' } };
    const difference = Number(payment.proof_total) - Number(payment.expected_total);
    const status = difference === 0 && Number(payment.instruction_total) === Number(payment.expected_total) ? 'MATCHED' : 'EXCEPTION';
    const id = `REC-${crypto.randomUUID()}`;
    await d1Batch(database, [
      { statement: `INSERT INTO reconciliations
        (id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status,reviewed_by)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(payment_instruction_id) DO UPDATE SET
        expected_total=excluded.expected_total,instruction_total=excluded.instruction_total,proof_total=excluded.proof_total,
        difference=excluded.difference,status=excluded.status,reviewed_by=excluded.reviewed_by,created_at=${NOW}`,
        bindings: [id, payment.id, payment.expected_total, payment.instruction_total, payment.proof_total, difference, status, actor.email] },
      { statement: `UPDATE payment_instructions SET status=?,updated_at=${NOW} WHERE id=?`,
        bindings: [status === 'MATCHED' ? 'COMPLETED' : 'PAYMENT_EXCEPTION', payment.id] },
      { statement: `UPDATE payroll_submissions SET state=?,updated_at=${NOW} WHERE id=?`,
        bindings: [status === 'MATCHED' ? 'COMPLETED' : 'PAYMENT_EXCEPTION', payment.submission_id] },
      auditOperation(organizationId, actor, 'PAYMENT_RECONCILED', `${status} · difference ${difference}`, 'payment_instruction', payment.id),
    ]);
    const reconciliation = await d1First(database, 'SELECT * FROM reconciliations WHERE payment_instruction_id=?', [payment.id]);
    return { data: { ok: true, reconciliation } };
  }

  if (body.action === 'CREATE_INTEGRATION') {
    if (!PROCESSOR_ROLES.has(actor.role)) return { status: 403, data: { error: 'Insufficient role' } };
    const plan = await d1First(database, `SELECT id FROM client_service_plans WHERE id=? AND client_id=? AND status='ACTIVE' LIMIT 1`,
      [body.servicePlanId, body.clientId]);
    if (!plan) return { status: 409, data: { error: 'Active service plan not found' } };
    const id = body.id || `INT-${crypto.randomUUID()}`;
    const row = await d1First(database, `INSERT INTO integration_connections
      (id,org_id,client_id,service_plan_id,connector_type,status,config)
      VALUES (?,?,?,?,?,'INACTIVE',?) RETURNING *`,
      [id, organizationId, body.clientId, body.servicePlanId, body.connectorType, JSON.stringify(body.config || {})]);
    return { status: 201, data: { ok: true, integration: row } };
  }

  return { status: 422, data: { error: 'Action not implemented' } };
}

export async function handleD1OperatingModel({ request, env }, actor) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  try {
    const organizationId = orgId(env);
    if (request.method === 'GET') {
      const result = await readResource(env.DB, new URL(request.url).searchParams, actor, env, organizationId);
      return respond(result.data, result.status || 200);
    }
    let body;
    try { body = await parseBody(request); }
    catch (error) { return respond({ error: error.message === 'PAYLOAD_TOO_LARGE' ? 'Payload too large' : 'Invalid JSON' }, error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400); }
    const validation = validateOperatingAction(body);
    if (!validation.ok) return respond({ error: validation.errors.join('; ') }, 422);
    const result = await executeAction(env.DB, body, actor, env, organizationId);
    return respond(result.data, result.status || 200);
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
