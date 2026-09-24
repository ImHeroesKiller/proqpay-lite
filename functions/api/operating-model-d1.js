import { d1All, d1Batch, d1First } from './_d1.js';
import { applyEwaRepayments, markEwaRepaid } from './_ewa.js';
import { handlePreflight, publicError, secureJson } from './_security.js';
import { canTransition, resolveTierTransition, validateOperatingAction } from './operating-model-validation.js';
import { canonicalBankCode, decryptAccountNumber, encryptAccountNumber, instructionContentHash, sha256Hex } from './payment-instruction-core.js';

const METHODS = 'GET, POST, OPTIONS';
const PROCESSOR_ROLES = new Set(['SUPER_ADMIN', 'PAYROLL_PROCESSOR']);
const CONTROLLER_ROLES = new Set(['SUPER_ADMIN', 'PAYROLL_CONTROLLER']);
const CLIENT_ROLES = new Set(['CLIENT_USER']);
const ADJUSTMENT_PARENT_STATES = new Set([
  'PAYROLL_FINALIZED','CLIENT_APPROVAL_PENDING','CLIENT_APPROVED','PAYMENT_INSTRUCTION_READY',
  'PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED',
  'RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED',
]);
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
// HR master data contains employment types (TETAP/PKWT) as well as lifecycle
// statuses. Only explicit exit/inactive values must be excluded from payroll.
const ACTIVE_EMPLOYEE = `UPPER(TRIM(COALESCE(e.status_aktif,'ACTIVE'))) NOT IN
  ('INACTIVE','NONACTIVE','NON-ACTIVE','NON AKTIF','NONAKTIF','TIDAK AKTIF','RESIGN','RESIGNED',
   'TERMINATED','KELUAR','BERHENTI','PHK','PENSIUN','MENINGGAL','DECEASED','OFF','CANCELLED')`;

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
  if (role === 'SUPER_ADMIN') return true;
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

function scopeWhere({ organizationId, clientId, clientIds, projectIds = [], orgColumn = 's.org_id', clientColumn = 's.client_id', projectColumn = 's.project_id' }) {
  const clauses = [`${orgColumn}=?`];
  const bindings = [organizationId];
  if (clientId) { clauses.push(`${clientColumn}=?`); bindings.push(clientId); }
  else if (Array.isArray(clientIds)) {
    if (clientIds.length) {
      clauses.push(`${clientColumn} IN (${clientIds.map(()=>'?').join(',')})`);
      bindings.push(...clientIds);
    } else clauses.push('1=0');
  }
  if (projectIds.length) {
    clauses.push(`${projectColumn} IN (${projectIds.map(() => '?').join(',')})`);
    bindings.push(...projectIds);
  }
  return { sql: clauses.join(' AND '), bindings };
}

const SUBMISSION_SELECT = `SELECT s.*, c.name AS client_name, p.name AS project_name,
  CASE WHEN EXISTS(SELECT 1 FROM payroll_run_lines prl WHERE prl.submission_id=s.id)
    THEN (SELECT COUNT(*) FROM payroll_run_lines prl WHERE prl.submission_id=s.id AND prl.included=1)
    ELSE COALESCE((SELECT COUNT(*) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
    WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id)
      AND ec.payroll_source_period=s.period),0) END AS employee_count,
  CASE WHEN EXISTS(SELECT 1 FROM payroll_run_lines prl WHERE prl.submission_id=s.id)
    THEN COALESCE((SELECT SUM(prl.gross_amount) FROM payroll_run_lines prl WHERE prl.submission_id=s.id AND prl.included=1),0)
    ELSE COALESCE((SELECT SUM(ec.imported_gross) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
    WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id)
      AND ec.payroll_source_period=s.period),0) END AS total_gross,
  CASE WHEN EXISTS(SELECT 1 FROM payroll_run_lines prl WHERE prl.submission_id=s.id)
    THEN COALESCE((SELECT SUM(prl.deduction_amount) FROM payroll_run_lines prl WHERE prl.submission_id=s.id AND prl.included=1),0)
    ELSE COALESCE((SELECT SUM(ec.imported_deduction) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
    WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id)
      AND ec.payroll_source_period=s.period),0) END AS total_deduction,
  CASE WHEN EXISTS(SELECT 1 FROM payroll_run_lines prl WHERE prl.submission_id=s.id)
    THEN COALESCE((SELECT SUM(prl.net_amount) FROM payroll_run_lines prl WHERE prl.submission_id=s.id AND prl.included=1),0)
    ELSE COALESCE((SELECT SUM(ec.imported_net) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
    WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id)
      AND ec.payroll_source_period=s.period),0) END AS total_net,
  (SELECT COUNT(*) FROM payroll_exceptions pe WHERE pe.submission_id=s.id) AS exception_count,
  (SELECT COUNT(*) FROM payroll_exceptions pe WHERE pe.submission_id=s.id
    AND pe.status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')) AS open_exception_count,
  (SELECT COUNT(*) FROM payroll_exceptions pe WHERE pe.submission_id=s.id
    AND pe.status='CLIENT_ACTION_REQUIRED') AS client_action_count,
  (SELECT COUNT(*) FROM payroll_exceptions pe WHERE pe.submission_id=s.id AND pe.severity='CRITICAL'
    AND pe.status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')) AS blocking_count,
  (SELECT pi_status.status FROM payment_instructions pi_status
    WHERE pi_status.submission_id=s.id AND pi_status.org_id=s.org_id AND pi_status.status<>'REJECTED'
    ORDER BY pi_status.updated_at DESC,pi_status.created_at DESC LIMIT 1) AS payment_status,
  (SELECT r.status FROM reconciliations r
    JOIN payment_instructions pi_rec ON pi_rec.id=r.payment_instruction_id
    WHERE pi_rec.submission_id=s.id AND pi_rec.org_id=s.org_id
    ORDER BY r.created_at DESC LIMIT 1) AS reconciliation_status,
  (SELECT i.id FROM invoices i
    JOIN payment_instructions pi_invoice_id ON pi_invoice_id.id=i.payment_instruction_id
    WHERE pi_invoice_id.submission_id=s.id AND i.org_id=s.org_id
    ORDER BY i.updated_at DESC LIMIT 1) AS invoice_id,
  (SELECT i.status FROM invoices i
    JOIN payment_instructions pi_invoice ON pi_invoice.id=i.payment_instruction_id
    WHERE pi_invoice.submission_id=s.id AND i.org_id=s.org_id
    ORDER BY i.updated_at DESC LIMIT 1) AS invoice_status,
  (SELECT ar.status FROM ar_monitor ar
    JOIN invoices i_ar ON i_ar.id=ar.invoice_id
    JOIN payment_instructions pi_ar ON pi_ar.id=i_ar.payment_instruction_id
    WHERE pi_ar.submission_id=s.id AND ar.org_id=s.org_id
    ORDER BY ar.updated_at DESC LIMIT 1) AS ar_status
  FROM payroll_submissions s JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id`;

const PI_SELECT = `SELECT pi.*, s.period AS payroll_period, COALESCE(s.payment_period,s.period) AS payment_period,
  COALESCE(s.arrears_periods,'[]') AS arrears_periods, c.name AS client_name, p.name AS project_name,
  (SELECT al.detail FROM audit_logs al WHERE al.entity='payment_instruction' AND al.entity_id=pi.id
    AND al.action='PAYMENT_INSTRUCTION_REJECTED' ORDER BY al.timestamp DESC LIMIT 1) AS rejection_reason,
  (SELECT al.username FROM audit_logs al WHERE al.entity='payment_instruction' AND al.entity_id=pi.id
    AND al.action='PAYMENT_INSTRUCTION_REJECTED' ORDER BY al.timestamp DESC LIMIT 1) AS rejected_by,
  (SELECT al.timestamp FROM audit_logs al WHERE al.entity='payment_instruction' AND al.entity_id=pi.id
    AND al.action='PAYMENT_INSTRUCTION_REJECTED' ORDER BY al.timestamp DESC LIMIT 1) AS rejected_at
  FROM payment_instructions pi JOIN payroll_submissions s ON s.id=pi.submission_id
  JOIN clients c ON c.id=pi.client_id LEFT JOIN projects p ON p.id=s.project_id`;

async function readResource(database, params, actor, env, organizationId) {
  const resource = params.get('resource') || 'submissions';
  const clientId = params.get('clientId');
  const requestedPeriod = params.get('period');
  const dashboardOffset = Math.max(0, Number.parseInt(params.get('offset') || '0', 10) || 0);
  const projectIds = actor.role === 'CLIENT_USER' && Array.isArray(actor.projectIds) ? actor.projectIds.map(String) : [];
  const dashboardAggregate = resource === 'dashboard' || resource === 'dashboard-periods';
  const aggregateClientIds = actor.role === 'CLIENT_USER' && dashboardAggregate
    ? [...(clientScope(actor,env) || new Set())]
    : undefined;
  const selfScopingDetail = resource === 'pay-run-detail' || resource === 'payment-instruction-detail';
  if (actor.role === 'CLIENT_USER') {
    if (clientId && !assertClientScope(actor, env, clientId)) {
      return { status: 403, data: { error: 'Client scope denied' } };
    }
    if (!clientId && !selfScopingDetail && !dashboardAggregate) {
      return { status: 403, data: { error: 'Client scope required' } };
    }
  }
  const submissionScope = scopeWhere({ organizationId, clientId, clientIds:aggregateClientIds, projectIds });

  if (resource === 'dashboard-periods') {
    const rows = await d1All(database, `SELECT period FROM (
      SELECT s.period AS period FROM payroll_submissions s
        WHERE ${submissionScope.sql} AND s.state<>'CANCELLED'
      UNION
      SELECT COALESCE(s.payment_period,s.period) AS period FROM payroll_submissions s
        WHERE ${submissionScope.sql} AND s.state<>'CANCELLED'
    ) WHERE period IS NOT NULL AND period<>'' ORDER BY period DESC LIMIT 120`,
      [...submissionScope.bindings, ...submissionScope.bindings]);
    return { data:{ ok:true, periods:rows.map((row)=>String(row.period)) } };
  }

  if (resource === 'service-plans') {
    const where = clientId ? 'sp.client_id=? AND c.org_id=?' : 'c.org_id=?';
    const bindings = clientId ? [clientId, organizationId] : [organizationId];
    const rows = await d1All(database, `SELECT sp.* FROM client_service_plans sp JOIN clients c ON c.id=sp.client_id
      WHERE ${where} ORDER BY sp.effective_from DESC LIMIT 100`, bindings);
    return { data: { ok: true, servicePlans: rows } };
  }

  if (resource === 'pay-run-setup') {
    const clientWhere = clientId ? 'c.org_id=? AND c.id=?' : 'c.org_id=?';
    const clientBindings = clientId ? [organizationId, clientId] : [organizationId];
    const projectScope = scopeWhere({ organizationId, clientId, projectIds, orgColumn:'p.org_id', clientColumn:'p.client_id', projectColumn:'p.id' });
    const [clients, projects, servicePlans] = await Promise.all([
      d1All(database, `SELECT c.id,c.name,c.code,c.status,
        (SELECT COUNT(*) FROM employees e WHERE e.client_id=c.id AND e.org_id=c.org_id AND ${ACTIVE_EMPLOYEE}) AS employee_count,
        (SELECT COUNT(*) FROM employees e WHERE e.client_id=c.id AND e.org_id=c.org_id AND e.project_id IS NULL AND ${ACTIVE_EMPLOYEE}) AS unassigned_employee_count
        FROM clients c WHERE ${clientWhere} AND c.status='ACTIVE' ORDER BY c.name`, clientBindings),
      d1All(database, `SELECT p.id,p.client_id,p.name,p.code,p.status,
        (SELECT COUNT(*) FROM employees e WHERE e.project_id=p.id AND e.client_id=p.client_id AND e.org_id=p.org_id AND ${ACTIVE_EMPLOYEE}) AS employee_count
        FROM projects p WHERE ${projectScope.sql} AND p.status='ACTIVE' ORDER BY p.name`, projectScope.bindings),
      d1All(database, `SELECT sp.id,sp.client_id,sp.project_id,sp.tier,sp.effective_from,sp.effective_until
        FROM client_service_plans sp JOIN clients c ON c.id=sp.client_id
        WHERE c.org_id=? AND (? IS NULL OR sp.client_id=?) AND sp.status='ACTIVE' ORDER BY sp.effective_from DESC`, [organizationId,clientId||null,clientId||null]),
    ]);
    return { data:{ ok:true, clients, projects, servicePlans } };
  }

  if (resource === 'pay-run-detail') {
    const submissionId = params.get('submissionId');
    if (!submissionId) return { status:422, data:{ error:'submissionId wajib diisi' } };
    const submission = await d1First(database, `${SUBMISSION_SELECT} WHERE s.id=? AND s.org_id=? LIMIT 1`, [submissionId, organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    if (!assertClientScope(actor, env, submission.client_id) || !assertProjectScope(actor, submission.project_id)) return { status:403, data:{ error:'Scope denied' } };
    const previous = await d1First(database, `SELECT id,period FROM payroll_submissions WHERE org_id=? AND client_id=?
      AND COALESCE(project_id,'')=COALESCE(?,'') AND run_type='REGULAR' AND period<? AND state<>'CANCELLED'
      ORDER BY period DESC,created_at DESC LIMIT 1`, [organizationId, submission.client_id, submission.project_id || null, submission.period]);
    const lines = await d1All(database, `SELECT current.*,
      previous.gross_amount AS previous_gross,previous.deduction_amount AS previous_deduction,previous.net_amount AS previous_net,
      previous.account_last4 AS previous_account_last4,previous.employment_status AS previous_employment_status,
      CASE
        WHEN previous.employee_id IS NULL THEN 'NEW'
        WHEN current.net_amount<>previous.net_amount OR current.gross_amount<>previous.gross_amount
          OR current.deduction_amount<>previous.deduction_amount
          OR COALESCE(current.account_last4,'')<>COALESCE(previous.account_last4,'') THEN 'CHANGED'
        ELSE 'UNCHANGED' END AS variance_type
      FROM payroll_run_lines current LEFT JOIN payroll_run_lines previous
        ON previous.submission_id=? AND previous.employee_id=current.employee_id
      WHERE current.submission_id=? ORDER BY current.employee_name`, [previous?.id || '', submission.id]);
    parseJsonFields(lines, ['components']);
    const removed = previous ? await d1All(database, `SELECT p.employee_id,p.employee_name,p.net_amount AS previous_net
      FROM payroll_run_lines p LEFT JOIN payroll_run_lines c ON c.submission_id=? AND c.employee_id=p.employee_id
      WHERE p.submission_id=? AND p.included=1 AND c.employee_id IS NULL ORDER BY p.employee_name`, [submission.id, previous.id]) : [];
    const includedLines=lines.filter((line)=>line.included);
    const currentTotal = includedLines.reduce((sum,line)=>sum+Number(line.net_amount||0),0);
    const previousTotal = includedLines.reduce((sum,line)=>sum+Number(line.previous_net||0),0)
      + removed.reduce((sum,line)=>sum+Number(line.previous_net||0),0);
    const currentGross=includedLines.reduce((sum,line)=>sum+Number(line.gross_amount||0),0);
    const previousGross=includedLines.reduce((sum,line)=>sum+Number(line.previous_gross||0),0);
    const currentDeduction=includedLines.reduce((sum,line)=>sum+Number(line.deduction_amount||0),0);
    const previousDeduction=includedLines.reduce((sum,line)=>sum+Number(line.previous_deduction||0),0);
    return { data:{ ok:true, submission, previousPeriod:previous?.period || null, lines, removed,
      variance:{ currentTotal, previousTotal, amount:currentTotal-previousTotal,
        percent:previousTotal ? Number((((currentTotal-previousTotal)/previousTotal)*100).toFixed(2)) : null,
        currentGross,previousGross,grossAmount:currentGross-previousGross,
        currentDeduction,previousDeduction,deductionAmount:currentDeduction-previousDeduction,
        currentHeadcount:includedLines.length,
        previousHeadcount:includedLines.filter((line)=>line.previous_net!=null).length+removed.length,
        headcountAmount:includedLines.length-(includedLines.filter((line)=>line.previous_net!=null).length+removed.length),
        newEmployees:includedLines.filter((line)=>line.variance_type==='NEW').length,
        changedEmployees:includedLines.filter((line)=>line.variance_type==='CHANGED').length,
        removedEmployees:removed.length,
        bankChangedEmployees:includedLines.filter((line)=>line.previous_account_last4&&line.account_last4&&String(line.previous_account_last4)!==String(line.account_last4)).length } } };
  }

  if (resource === 'exceptions') {
    const exceptionOffset = Math.max(0, Number.parseInt(params.get('offset') || '0', 10) || 0);
    const exceptionLimit = Math.min(500, Math.max(50, Number.parseInt(params.get('limit') || '500', 10) || 500));
    const rows = await d1All(database, `SELECT e.*, s.client_id, s.project_id, s.period, s.service_tier,
      c.name AS client_name, p.name AS project_name, emp.name AS employee_name,
      (SELECT au.email FROM app_users au JOIN user_client_scopes ucs ON ucs.user_id=au.id
       WHERE ucs.client_id=s.client_id AND au.role='CLIENT_USER' AND au.status='ACTIVE'
       ORDER BY au.created_at LIMIT 1) AS client_email
      FROM payroll_exceptions e JOIN payroll_submissions s ON s.id=e.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      LEFT JOIN employees emp ON emp.id=e.employee_id
      WHERE ${submissionScope.sql} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      [...submissionScope.bindings, exceptionLimit + 1, exceptionOffset]);
    const truncated = rows.length > exceptionLimit;
    const page = rows.slice(0, exceptionLimit);
    return { data: { ok: true, exceptions: parseJsonFields(page, ['source_value','canonical_value','suggested_value']),
      exceptionsMeta:{ offset:exceptionOffset, limit:exceptionLimit, returned:page.length,
        nextOffset:truncated ? exceptionOffset + exceptionLimit : null, truncated } } };
  }

  if (resource === 'exception-history') {
    const exceptionId = params.get('exceptionId');
    if (!exceptionId) return { status:422, data:{ error:'exceptionId wajib diisi' } };
    const current = await d1First(database, `SELECT e.id,s.client_id,s.project_id FROM payroll_exceptions e
      JOIN payroll_submissions s ON s.id=e.submission_id WHERE e.id=? AND s.org_id=? LIMIT 1`, [exceptionId,organizationId]);
    if (!current) return { status:404, data:{ error:'Exception not found' } };
    if (!assertClientScope(actor,env,current.client_id) || !assertProjectScope(actor,current.project_id)) return { status:403, data:{ error:'Scope denied' } };
    const history = await d1All(database, `SELECT id,username,role,action,detail,timestamp
      FROM audit_logs WHERE org_id=? AND entity='payroll_exception' AND entity_id=?
      ORDER BY timestamp DESC LIMIT 100`, [organizationId,exceptionId]);
    return { data:{ ok:true, exceptionHistory:history } };
  }

  if (resource === 'payment-instructions') {
    const scope = scopeWhere({ organizationId, clientId, orgColumn: 'pi.org_id', clientColumn: 'pi.client_id', projectIds, projectColumn: 's.project_id' });
    const rows = await d1All(database, `${PI_SELECT} WHERE ${scope.sql} ORDER BY pi.created_at DESC LIMIT 100`, scope.bindings);
    return { data: { ok: true, paymentInstructions: parseJsonFields(rows, ['arrears_periods']) } };
  }

  if (resource === 'payment-instruction-detail') {
    const paymentInstructionId = params.get('paymentInstructionId');
    if (!paymentInstructionId) return { status: 422, data: { error: 'paymentInstructionId wajib diisi' } };
    const instruction = await d1First(database, `SELECT pi.*, s.project_id AS project_id, s.period AS payroll_period,
      COALESCE(s.payment_period,s.period) AS payment_period, c.name AS client_name, p.name AS project_name,
      maker.email AS creator_email,
      (SELECT al.detail FROM audit_logs al WHERE al.entity='payment_instruction' AND al.entity_id=pi.id
        AND al.action='PAYMENT_INSTRUCTION_REJECTED' ORDER BY al.timestamp DESC LIMIT 1) AS rejection_reason,
      (SELECT al.username FROM audit_logs al WHERE al.entity='payment_instruction' AND al.entity_id=pi.id
        AND al.action='PAYMENT_INSTRUCTION_REJECTED' ORDER BY al.timestamp DESC LIMIT 1) AS rejected_by,
      (SELECT al.timestamp FROM audit_logs al WHERE al.entity='payment_instruction' AND al.entity_id=pi.id
        AND al.action='PAYMENT_INSTRUCTION_REJECTED' ORDER BY al.timestamp DESC LIMIT 1) AS rejected_at
      FROM payment_instructions pi
      JOIN payroll_submissions s ON s.id=pi.submission_id JOIN clients c ON c.id=pi.client_id
      LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN app_users maker ON maker.id=pi.creator_user_id
      WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [paymentInstructionId, organizationId]);
    if (!instruction) return { status: 404, data: { error: 'Payment instruction tidak ditemukan' } };
    if (!assertClientScope(actor, env, instruction.client_id) || !assertProjectScope(actor, instruction.project_id)) {
      return { status: 403, data: { error: 'Payment instruction scope denied' } };
    }
    const [lines, approvals] = await Promise.all([
      d1All(database, `SELECT id,employee_id,beneficiary_name,bank_name,bank_code,
        COALESCE(account_last4,substr(masked_account,-4)) AS account_last4,masked_account,amount,line_hash
        FROM payment_instruction_lines WHERE payment_instruction_id=? ORDER BY beneficiary_name,id LIMIT 5000`, [paymentInstructionId]),
      d1All(database, `SELECT pa.id,pa.status,pa.created_at,pa.action_hash,au.email AS approver_email
        FROM payment_approvals pa LEFT JOIN app_users au ON au.id=pa.approver_user_id
        WHERE pa.payment_instruction_id=? ORDER BY pa.created_at`, [paymentInstructionId]),
    ]);
    const total = lines.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expectedRecipients = Number(instruction.recipient_count || 0);
    const recipientBalanced = expectedRecipients === lines.length;
    return { data: { ok: true, paymentInstruction: instruction, lines, approvals,
      control: {
        recipientCount: lines.length,
        expectedRecipientCount: expectedRecipients,
        recipientBalanced,
        totalAmount: total,
        expectedTotal: Number(instruction.expected_total),
        balanced: total === Number(instruction.expected_total),
      } } };
  }

  if (resource === 'payment-proofs') {
    const scope = scopeWhere({ organizationId, clientId, projectIds, orgColumn: 'pi.org_id', clientColumn: 'pi.client_id', projectColumn: 's.project_id' });
    const rows = await d1All(database, `SELECT pp.id,pp.payment_instruction_id,pp.bank,pp.reference,
      pp.transaction_date,pp.amount,pp.created_at FROM payment_proofs pp
      JOIN payment_instructions pi ON pi.id=pp.payment_instruction_id
      JOIN payroll_submissions s ON s.id=pi.submission_id
      WHERE ${scope.sql} ORDER BY pp.created_at DESC LIMIT 200`, scope.bindings);
    return { data: { ok: true, paymentProofs: rows } };
  }

  if (resource === 'reconciliations') {
    const scope = scopeWhere({ organizationId, clientId, projectIds, orgColumn: 'pi.org_id', clientColumn: 'pi.client_id', projectColumn: 's.project_id' });
    const rows = await d1All(database, `SELECT r.* FROM reconciliations r
      JOIN payment_instructions pi ON pi.id=r.payment_instruction_id
      JOIN payroll_submissions s ON s.id=pi.submission_id
      WHERE ${scope.sql} ORDER BY r.created_at DESC LIMIT 200`, scope.bindings);
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
      COALESCE(
        NULLIF((SELECT SUM(pp.amount) FROM payment_proofs pp WHERE pp.payment_instruction_id=pi.id),0),
        (SELECT pgt.amount FROM payment_gateway_transactions pgt
          WHERE pgt.payment_instruction_id=pi.id AND pgt.status='SUCCEEDED'
          ORDER BY COALESCE(pgt.paid_at,pgt.updated_at,pgt.created_at) DESC LIMIT 1),
        0
      ) AS paid_total,
      COALESCE(
        (SELECT MAX(pp.transaction_date) FROM payment_proofs pp WHERE pp.payment_instruction_id=pi.id),
        (SELECT substr(COALESCE(pgt.paid_at,pgt.updated_at,pgt.created_at),1,10) FROM payment_gateway_transactions pgt
          WHERE pgt.payment_instruction_id=pi.id AND pgt.status='SUCCEEDED'
          ORDER BY COALESCE(pgt.paid_at,pgt.updated_at,pgt.created_at) DESC LIMIT 1)
      ) AS payment_date,
      (SELECT pp.id FROM payment_proofs pp WHERE pp.payment_instruction_id=pi.id ORDER BY pp.created_at DESC LIMIT 1) AS proof_id,
      (SELECT r.status FROM reconciliations r WHERE r.payment_instruction_id=pi.id LIMIT 1) AS reconciliation_status,
      (SELECT r.difference FROM reconciliations r WHERE r.payment_instruction_id=pi.id LIMIT 1) AS difference,
      (SELECT COUNT(*) FROM payment_instruction_lines pil WHERE pil.payment_instruction_id=pi.id) AS employee_count,
      pi.created_at,pi.updated_at FROM payment_instructions pi JOIN payroll_submissions s ON s.id=pi.submission_id
      JOIN clients c ON c.id=pi.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${scope.sql} ORDER BY COALESCE(s.payment_period,s.period) DESC,pi.created_at DESC LIMIT 500`, scope.bindings);
    return { data: { ok: true, paymentReports: parseJsonFields(rows, ['arrears_periods']) } };
  }

  const dashboardPeriodSql = resource === 'dashboard' && requestedPeriod
    ? ' AND (s.period=? OR COALESCE(s.payment_period,s.period)=?)'
    : '';
  const dashboardBindings = requestedPeriod && resource === 'dashboard'
    ? [...submissionScope.bindings, requestedPeriod, requestedPeriod]
    : submissionScope.bindings;
  const submissionLimit = resource === 'dashboard' ? 1000 : 200;
  const dashboardPagingSql = resource === 'dashboard' ? ` OFFSET ${dashboardOffset}` : '';
  const submissions = await d1All(database, `${SUBMISSION_SELECT} WHERE ${submissionScope.sql}${dashboardPeriodSql}
    ORDER BY s.created_at DESC LIMIT ${submissionLimit}${dashboardPagingSql}`, dashboardBindings);
  parseJsonFields(submissions, ['arrears_periods']);
  if (resource !== 'dashboard') return { data: { ok: true, submissions } };

  const totalRow = await d1First(database, `SELECT COUNT(*) AS total FROM payroll_submissions s
    WHERE ${submissionScope.sql}${dashboardPeriodSql}`, dashboardBindings);
  const submissionsTotal = Number(totalRow?.total || 0);
  const submissionIds = submissions.map((row)=>String(row.id));
  const clientDashboardSubmissionFields = new Set([
    'id','client_id','project_id','service_plan_id','service_tier','period','payment_period','arrears_periods',
    'state','run_type','source_mode','input_status','period_status','payment_date','created_at','updated_at',
    'client_name','project_name','employee_count','total_gross','total_deduction','total_net',
    'exception_count','open_exception_count','client_action_count','blocking_count','payment_status',
    'reconciliation_status','invoice_id','invoice_status','ar_status'
  ]);
  const dashboardSubmissions = actor.role === 'CLIENT_USER'
    ? submissions.map((row)=>Object.fromEntries(Object.entries(row).filter(([key])=>clientDashboardSubmissionFields.has(key))))
    : submissions;
  let paymentInstructions = [];
  if (submissionIds.length) {
    const placeholders = submissionIds.map(()=>'?').join(',');
    const internalHash = actor.role === 'CLIENT_USER' ? '' : ', pi.content_hash';
    paymentInstructions = await d1All(database, `SELECT
      pi.id,pi.client_id,pi.submission_id,pi.status,pi.expected_total,pi.document_no,
      pi.currency,pi.recipient_count,pi.created_at,pi.updated_at${internalHash},
      s.period AS payroll_period,COALESCE(s.payment_period,s.period) AS payment_period,
      c.name AS client_name,p.name AS project_name,
      (SELECT COUNT(*) FROM payment_proofs pp WHERE pp.payment_instruction_id=pi.id) AS proof_count
      FROM payment_instructions pi
      JOIN payroll_submissions s ON s.id=pi.submission_id
      JOIN clients c ON c.id=pi.client_id
      LEFT JOIN projects p ON p.id=s.project_id
      WHERE pi.org_id=? AND pi.status<>'REJECTED'
        AND pi.submission_id IN (${placeholders})
      ORDER BY pi.updated_at DESC,pi.created_at DESC`,
      [organizationId,...submissionIds]);
  }

  const clientSummaryScope = scopeWhere({ organizationId, clientId, clientIds:aggregateClientIds, projectIds: [], orgColumn: 'c.org_id', clientColumn: 'c.id' });
  const projectScope = scopeWhere({ organizationId, clientId, clientIds:aggregateClientIds, projectIds, orgColumn: 'p.org_id', clientColumn: 'p.client_id', projectColumn: 'p.id' });
  const employeeScope = scopeWhere({ organizationId, clientId, clientIds:aggregateClientIds, projectIds, orgColumn: 'e.org_id', clientColumn: 'e.client_id', projectColumn: 'e.project_id' });
  const [clientCount, projectCount, employeeCount, bankCount] = await Promise.all([
    d1First(database, `SELECT COUNT(*) AS total FROM clients c WHERE ${clientSummaryScope.sql}`, clientSummaryScope.bindings),
    d1First(database, `SELECT COUNT(*) AS total FROM projects p WHERE ${projectScope.sql}`, projectScope.bindings),
    d1First(database, `SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${ACTIVE_EMPLOYEE} THEN 1 ELSE 0 END) AS active
      FROM employees e WHERE ${employeeScope.sql}`, employeeScope.bindings),
    d1First(database, `SELECT COUNT(DISTINCT e.id) AS total FROM employees e
      JOIN employee_bank_accounts eba ON eba.employee_id=e.id AND eba.is_primary=1
      WHERE ${employeeScope.sql}`, employeeScope.bindings),
  ]);
  const employees = Number(employeeCount?.total || 0);
  const primaryAccounts = Number(bankCount?.total || 0);
  return { data: { ok: true, submissions:dashboardSubmissions, paymentInstructions,
    // Dashboard intentionally carries summary-level evidence only. Detailed exceptions,
    // proofs and reconciliation records stay in their dedicated workspaces.
    exceptions: [], paymentProofs: [], reconciliations: [],
    dashboardMeta: {
      period: requestedPeriod || 'ALL',
      submissionsTotal,
      submissionsReturned: submissions.length,
      offset: dashboardOffset,
      nextOffset: dashboardOffset + submissions.length < submissionsTotal ? dashboardOffset + submissions.length : null,
      truncated: dashboardOffset + submissions.length < submissionsTotal,
    },
    portfolioSummary: { clients: Number(clientCount?.total || 0), projects: Number(projectCount?.total || 0),
      employees, activeEmployees: Number(employeeCount?.active || 0), primaryAccounts,
      bankCoveragePercent: employees ? Math.round((primaryAccounts / employees) * 100) : 0 } } };
}

function auditOperation(organizationId, actor, action, detail, entity, entityId) {
  return { statement: `INSERT INTO audit_logs (id,org_id,username,role,action,detail,entity,entity_id)
    VALUES (?,?,?,?,?,?,?,?)`, bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role, action, detail, entity, entityId] };
}

async function getCloseReadiness(database, organizationId, submission) {
  const payment = await d1First(database, `SELECT * FROM payment_instructions
    WHERE submission_id=? AND org_id=? AND status<>'REJECTED'
    ORDER BY updated_at DESC,created_at DESC LIMIT 1`, [submission.id, organizationId]);
  const reconciliation = payment ? await d1First(database,
    'SELECT * FROM reconciliations WHERE payment_instruction_id=? ORDER BY created_at DESC LIMIT 1', [payment.id]) : null;
  const invoice = payment ? await d1First(database,
    'SELECT * FROM invoices WHERE payment_instruction_id=? AND org_id=? ORDER BY updated_at DESC LIMIT 1', [payment.id, organizationId]) : null;
  const blocking = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_exceptions WHERE submission_id=?
    AND severity='CRITICAL' AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`, [submission.id]);
  const reasons = [];
  if (submission.input_status !== 'READY') reasons.push('PAYROLL_INPUT_NOT_FINAL');
  if (submission.state !== 'COMPLETED') reasons.push('PAYROLL_NOT_RECONCILED');
  if (!payment || payment.status !== 'COMPLETED') reasons.push('PAYMENT_NOT_COMPLETED');
  if (!reconciliation || reconciliation.status !== 'MATCHED') reasons.push('RECONCILIATION_NOT_MATCHED');
  if (!invoice || !['ISSUED','PARTIALLY_PAID','PAID'].includes(String(invoice.status || ''))) reasons.push('INVOICE_NOT_ISSUED');
  if (Number(blocking?.count || 0) > 0) reasons.push('CRITICAL_EXCEPTIONS_OPEN');
  return {
    ready: reasons.length === 0,
    reasons,
    paymentInstructionId: payment?.id || null,
    paymentStatus: payment?.status || null,
    reconciliationStatus: reconciliation?.status || null,
    invoiceId: invoice?.id || null,
    invoiceStatus: invoice?.status || null,
    arCollectionStatus: invoice?.status === 'PAID' ? 'PAID' : invoice ? 'OPEN' : null,
    blockingCount: Number(blocking?.count || 0),
  };
}

async function validateCanonicalPayRunSnapshot(database, submission, actor, organizationId) {
  const rows = await d1All(database, `SELECT l.employee_id,l.employee_name,l.gross_amount,l.deduction_amount,l.net_amount,
      l.bank_name,l.account_last4,e.status_aktif,e.client_id AS current_client_id,e.project_id AS current_project_id,
      CASE WHEN e.org_id=? AND e.client_id=? AND e.project_id=? AND ${ACTIVE_EMPLOYEE} THEN 1 ELSE 0 END AS eligible_now,
      eba.bank_name AS primary_bank_name,eba.account_no AS primary_account_no
    FROM payroll_run_lines l
    JOIN employees e ON e.id=l.employee_id
    LEFT JOIN employee_bank_accounts eba ON eba.employee_id=l.employee_id AND eba.is_primary=1
    WHERE l.submission_id=? AND l.included=1 ORDER BY l.employee_id`,
    [organizationId,submission.client_id,submission.project_id,submission.id]);
  const missingEligible = await d1All(database, `SELECT e.id AS employee_id,e.name AS employee_name
    FROM employees e WHERE e.org_id=? AND e.client_id=? AND e.project_id=? AND ${ACTIVE_EMPLOYEE}
      AND NOT EXISTS(SELECT 1 FROM payroll_run_lines l WHERE l.submission_id=? AND l.employee_id=e.id AND l.included=1)
    ORDER BY e.name`, [organizationId,submission.client_id,submission.project_id,submission.id]);
  const issues = [];
  const add = (row, category, field, reason) => issues.push({
    employeeId: row?.employee_id || null,
    category,
    field,
    reason,
  });
  if (!rows.length) add(null, 'SYSTEM_EMPTY_PAY_RUN', 'recipients', 'Pay Run tidak memiliki penerima aktif.');

  for (const row of rows) {
    if (!Number(row.eligible_now)) {
      add(row, 'SYSTEM_EMPLOYEE_NOT_ELIGIBLE', 'employeeScope',
        `${row.employee_name || row.employee_id} tidak lagi aktif/eligible pada client dan project Pay Run ini.`);
    }
    const gross = Number(row.gross_amount);
    const deduction = Number(row.deduction_amount);
    const net = Number(row.net_amount);
    if (!Number.isSafeInteger(gross) || gross <= 0 || !Number.isSafeInteger(deduction) || deduction < 0
      || !Number.isSafeInteger(net) || net <= 0 || gross - deduction !== net) {
      add(row, 'SYSTEM_PAYROLL_CONTROL_MISMATCH', 'netAmount',
        `Control payroll tidak balance untuk ${row.employee_name || row.employee_id}: Gross ${gross} - Potongan ${deduction} != THP ${net}.`);
    }
    const account = String(row.primary_account_no || '').replace(/\s+/g, '');
    if (!row.primary_bank_name || !/^\d{6,34}$/.test(account)) {
      add(row, 'SYSTEM_BANK_INVALID', 'accountNo',
        'Rekening utama penerima tidak lengkap atau nomor rekening bukan 6-34 digit.');
    } else if (row.account_last4 && account.slice(-4) !== String(row.account_last4)) {
      add(row, 'SYSTEM_BANK_CHANGED', 'accountNo',
        'Rekening utama berubah setelah snapshot Pay Run dibuat; refresh data sebelum melanjutkan.');
    }
  }
  for (const row of missingEligible) {
    add(row, 'SYSTEM_EMPLOYEE_MISSING', 'employeeScope',
      `${row.employee_name || row.employee_id} aktif pada project tetapi belum masuk snapshot Pay Run.`);
  }

  const previous = await d1All(database, `SELECT id FROM payroll_exceptions
    WHERE submission_id=? AND category LIKE 'SYSTEM_%'
      AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`, [submission.id]);
  const operations = previous.length ? [{
    statement:`UPDATE payroll_exceptions SET status='AUTO_NORMALIZED',resolution_note='Superseded by deterministic re-validation',
      resolved_at=${NOW},resolved_by=? WHERE submission_id=? AND category LIKE 'SYSTEM_%'
      AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`,
    bindings:[actor.email,submission.id],
  }] : [];
  for (const issue of issues) operations.push({
    statement:`INSERT INTO payroll_exceptions
      (id,submission_id,employee_id,field,category,severity,reason,owner,status)
      VALUES (?,?,?,?,?,'CRITICAL',?,'PAYROLL_PROCESSOR','OPEN')`,
    bindings:[`EXC-${crypto.randomUUID()}`,submission.id,issue.employeeId,issue.field,issue.category,issue.reason],
  });
  if (operations.length) await d1Batch(database, operations);
  if (issues.length) {
    await d1Batch(database, [
      { statement:`UPDATE payroll_submissions SET input_status='PENDING',updated_at=${NOW} WHERE id=?`, bindings:[submission.id] },
      auditOperation(organizationId, actor, 'PAY_RUN_DETERMINISTIC_VALIDATION_FAILED',
        `${issues.length} critical control issue(s) detected`, 'payroll_submission', submission.id),
    ]);
  }
  return { issues, recipients:rows.length };
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
    if (body.projectId) {
      const project=await d1First(database,'SELECT id FROM projects WHERE id=? AND client_id=? AND org_id=? LIMIT 1',[body.projectId,body.clientId,organizationId]);
      if (!project) return {status:404,data:{error:'Project tidak ditemukan pada klien tersebut'}};
    }
    const overlap = await d1First(database, `SELECT id FROM client_service_plans WHERE client_id=? AND COALESCE(project_id,'')=COALESCE(?,'') AND status='ACTIVE'
      AND effective_from<=COALESCE(?,'9999-12-31') AND COALESCE(effective_until,'9999-12-31')>=? LIMIT 1`,
      [body.clientId,body.projectId||null,body.effectiveUntil||null,body.effectiveFrom]);
    if (overlap) return { status: 409, data: { error: 'Service plan effective period overlaps an active plan', conflictingPlanId: overlap.id } };
    const id = body.id || `SP-${crypto.randomUUID()}`;
    const row = await d1First(database, `INSERT INTO client_service_plans
      (id,client_id,project_id,tier,status,contract_reference,effective_from,effective_until,created_by)
      VALUES (?,?,?,?,'ACTIVE',?,?,?,?) RETURNING *`,
      [id,body.clientId,body.projectId||null,body.tier,body.contractReference||null,body.effectiveFrom,body.effectiveUntil||null,actor.email]);
    return { status: 201, data: { ok: true, servicePlan: row } };
  }

  if (body.action === 'CREATE_SUBMISSION') {
    if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat membuat submission payroll' } };
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

  if (body.action === 'CREATE_PAY_RUN') {
    if (!PROCESSOR_ROLES.has(actor.role) || !actor.permissions?.includes('submission:write')) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat membuat Pay Run', code:'PAY_RUN_CREATE_PERMISSION_REQUIRED' } };
    if (body.sourceMode === 'UPLOAD_FINAL') return { status:409, data:{ error:'Upload payroll final harus melalui Data Intake canonical workflow', code:'PAY_RUN_UPLOAD_FINAL_MOVED_TO_DATA_INTAKE' } };
    if (!assertClientScope(actor, env, body.clientId) || !assertProjectScope(actor, body.projectId)) return { status:403, data:{ error:'Scope denied' } };
    const project = await d1First(database, `SELECT id FROM projects WHERE id=? AND client_id=? AND org_id=? AND status='ACTIVE' LIMIT 1`,
      [body.projectId, body.clientId, organizationId]);
    if (!project) return { status:409, data:{ error:'Project aktif tidak ditemukan pada klien tersebut' } };
    const effectiveDate = `${body.period}-01`;
    const plan = await d1First(database, `SELECT * FROM client_service_plans WHERE id=? AND client_id=? AND (project_id=? OR project_id IS NULL) AND status='ACTIVE'
      AND effective_from<date(?,'+1 month') AND (effective_until IS NULL OR effective_until>=?) LIMIT 1`,
      [body.servicePlanId,body.clientId,body.projectId,effectiveDate,effectiveDate]);
    if (!plan) return { status:409, data:{ error:'Service plan tidak aktif pada periode payroll' } };
    if (body.runType === 'ADJUSTMENT' && !body.parentSubmissionId) return { status:422, data:{ error:'Adjustment wajib mereferensikan Pay Run induk' } };
    if (body.runType !== 'ADJUSTMENT' && body.parentSubmissionId) return { status:422, data:{ error:'parentSubmissionId hanya boleh digunakan untuk Adjustment' } };
    let sourceSubmission = null;
    if (body.sourceMode === 'COPY_PREVIOUS') {
      sourceSubmission = await d1First(database, `SELECT id,period FROM payroll_submissions WHERE org_id=? AND client_id=?
        AND project_id=? AND run_type='REGULAR' AND period<? AND state<>'CANCELLED' ORDER BY period DESC,created_at DESC LIMIT 1`,
        [organizationId, body.clientId, body.projectId, body.period]);
      if (!sourceSubmission) return { status:409, data:{ error:'Belum ada Pay Run periode sebelumnya untuk disalin' } };
      const sourceLines = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_run_lines WHERE submission_id=?`, [sourceSubmission.id]);
      if (!Number(sourceLines?.count||0)) return { status:409, data:{ error:'Pay Run sebelumnya belum memiliki snapshot canonical; siapkan periode pertama melalui Data Intake atau Master Current' } };
    }
    if (body.parentSubmissionId) {
      const parent = await d1First(database, `SELECT id,period,run_type,state,period_status FROM payroll_submissions
        WHERE id=? AND org_id=? AND client_id=? AND project_id=? LIMIT 1`,
        [body.parentSubmissionId, organizationId, body.clientId, body.projectId]);
      if (!parent) return { status:409, data:{ error:'Pay Run induk tidak valid' } };
      if (parent.run_type !== 'REGULAR' || !ADJUSTMENT_PARENT_STATES.has(String(parent.state || '')) || parent.period > body.period) {
        return { status:409, data:{
          error:'Adjustment hanya boleh mereferensikan Pay Run REGULAR yang sudah final/approved pada periode yang sama atau sebelumnya',
          code:'ADJUSTMENT_PARENT_NOT_FINAL',
        } };
      }
    }
    const eligible = await d1First(database, `SELECT COUNT(*) AS count FROM employees e WHERE e.org_id=? AND e.client_id=? AND e.project_id=?
      AND ${ACTIVE_EMPLOYEE}`, [organizationId, body.clientId, body.projectId]);
    if (!Number(eligible?.count || 0) && !sourceSubmission) {
      const coverage = await d1First(database, `SELECT
        COUNT(*) AS client_count,
        SUM(CASE WHEN e.project_id IS NULL THEN 1 ELSE 0 END) AS unassigned_count
        FROM employees e WHERE e.org_id=? AND e.client_id=? AND ${ACTIVE_EMPLOYEE}`, [organizationId, body.clientId]);
      const detail = Number(coverage?.client_count || 0)
        ? ` Klien memiliki ${Number(coverage.client_count)} karyawan aktif; ${Number(coverage.unassigned_count || 0)} belum dipasangkan ke project.` : '';
      return { status:409, data:{ error:`Project tidak memiliki karyawan aktif untuk payroll.${detail} Periksa assignment karyawan pada master Employees.` } };
    }
    const id = `SUB-${crypto.randomUUID()}`;
    const inputStatus = body.sourceMode === 'COPY_PREVIOUS' ? 'READY' : 'PENDING';
    const operations = [{ statement:`INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,payment_date,
       run_type,source_mode,parent_submission_id,input_status,state,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?)`, bindings:[id,organizationId,body.clientId,body.projectId,
        body.servicePlanId,plan.tier,body.period,body.paymentPeriod,body.paymentDate,body.runType,body.sourceMode,
        body.parentSubmissionId || null,inputStatus,actor.email] }];
    if (sourceSubmission) {
      operations.push({ statement:`INSERT INTO payroll_run_lines
        (id,submission_id,employee_id,employee_code,employee_name,employment_status,bank_name,account_last4,
         gross_amount,deduction_amount,net_amount,components,source,included)
        SELECT 'PRL-'||lower(hex(randomblob(16))),?,l.employee_id,l.employee_code,l.employee_name,l.employment_status,
          COALESCE((SELECT bank_name FROM employee_bank_accounts WHERE employee_id=l.employee_id AND is_primary=1 LIMIT 1),l.bank_name),
          COALESCE((SELECT substr(account_no,-4) FROM employee_bank_accounts WHERE employee_id=l.employee_id AND is_primary=1 LIMIT 1),l.account_last4),
          l.gross_amount,l.deduction_amount,l.net_amount,l.components,'COPY_PREVIOUS',l.included
        FROM payroll_run_lines l WHERE l.submission_id=?`, bindings:[id,sourceSubmission.id] });
      operations.push({ statement:`UPDATE payroll_run_lines SET included=0,updated_at=${NOW}
        WHERE submission_id=? AND NOT EXISTS(
          SELECT 1 FROM employees e WHERE e.id=payroll_run_lines.employee_id AND e.org_id=? AND e.client_id=? AND e.project_id=? AND ${ACTIVE_EMPLOYEE}
        )`, bindings:[id,organizationId,body.clientId,body.projectId] });
      operations.push({ statement:`INSERT INTO payroll_run_lines
        (id,submission_id,employee_id,employee_code,employee_name,employment_status,bank_name,account_last4,
         gross_amount,deduction_amount,net_amount,components,source,included)
        SELECT 'PRL-'||lower(hex(randomblob(16))),?,e.id,e.employee_code,e.name,e.status_aktif,
          (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1),
          (SELECT substr(account_no,-4) FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1),
          CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END,
          CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.imported_deduction,0) ELSE 0 END,
          MAX(0,(CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END)
            -(CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.imported_deduction,0) ELSE 0 END)),
          CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.payroll_components,'{}')
            ELSE json_object('Gaji Pokok',COALESCE(ec.basic_salary,0)) END,
          'COPY_PREVIOUS_NEW_EMPLOYEE',1
        FROM employees e LEFT JOIN employee_compensation ec ON ec.employee_id=e.id
        WHERE e.org_id=? AND e.client_id=? AND e.project_id=? AND ${ACTIVE_EMPLOYEE}
          AND NOT EXISTS(SELECT 1 FROM payroll_run_lines l WHERE l.submission_id=? AND l.employee_id=e.id)`,
        bindings:[id,body.period,body.period,body.period,body.period,body.period,organizationId,body.clientId,body.projectId,id] });
    } else {
      operations.push({ statement:`INSERT INTO payroll_run_lines
        (id,submission_id,employee_id,employee_code,employee_name,employment_status,bank_name,account_last4,
         gross_amount,deduction_amount,net_amount,components,source,included)
        SELECT 'PRL-'||lower(hex(randomblob(16))),?,e.id,e.employee_code,e.name,e.status_aktif,
          (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1),
          (SELECT substr(account_no,-4) FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1),
          CASE WHEN ?='MASTER_CURRENT' THEN CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0
            THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END ELSE 0 END,
          CASE WHEN ?='MASTER_CURRENT' AND ec.payroll_source_period=? AND ec.imported_gross>0
            THEN COALESCE(ec.imported_deduction,0) ELSE 0 END,
          CASE WHEN ?='MASTER_CURRENT' THEN MAX(0,
            CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END
            - CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.imported_deduction,0) ELSE 0 END)
            ELSE 0 END,
          CASE WHEN ?='MASTER_CURRENT' AND ec.payroll_source_period=? AND ec.imported_gross>0
            THEN COALESCE(ec.payroll_components,'{}')
            WHEN ?='MASTER_CURRENT' THEN json_object('Gaji Pokok',COALESCE(ec.basic_salary,0)) ELSE '{}' END,
          ?,1 FROM employees e LEFT JOIN employee_compensation ec ON ec.employee_id=e.id
          WHERE e.org_id=? AND e.client_id=? AND e.project_id=? AND ${ACTIVE_EMPLOYEE}`,
        bindings:[id,body.sourceMode,body.period,body.sourceMode,body.period,body.sourceMode,body.period,body.period,
          body.sourceMode,body.period,body.sourceMode,body.sourceMode,organizationId,body.clientId,body.projectId] });
    }
    operations.push(auditOperation(organizationId, actor, 'PAY_RUN_CREATED', `${body.runType} ${body.period} · ${body.sourceMode}`, 'payroll_submission', id));
    try { await d1Batch(database, operations); }
    catch (error) {
      if (/idx_one_regular_pay_run_scope|UNIQUE constraint failed/i.test(String(error?.message || error))) return { status:409, data:{ error:'Pay Run reguler untuk klien, project, dan periode tersebut sudah ada' } };
      throw error;
    }
    if (sourceSubmission) {
      const population = await d1First(database, `SELECT
        SUM(CASE WHEN source='COPY_PREVIOUS_NEW_EMPLOYEE' AND included=1 THEN 1 ELSE 0 END) AS added,
        SUM(CASE WHEN source='COPY_PREVIOUS' AND included=0 THEN 1 ELSE 0 END) AS excluded,
        SUM(CASE WHEN included=1 THEN 1 ELSE 0 END) AS active
        FROM payroll_run_lines WHERE submission_id=?`, [id]);
      await d1Batch(database, [
        auditOperation(organizationId,actor,'PAY_RUN_POPULATION_RECONCILED',
          JSON.stringify({sourceSubmissionId:sourceSubmission.id,added:Number(population?.added||0),excluded:Number(population?.excluded||0),active:Number(population?.active||0)}),
          'payroll_submission',id),
      ]);
    }
    const row = await d1First(database, `${SUBMISSION_SELECT} WHERE s.id=? LIMIT 1`, [id]);
    return { status:201, data:{ ok:true, submission:row, sourcePeriod:sourceSubmission?.period || null } };
  }

  if (body.action === 'REFRESH_PAY_RUN_FROM_MASTER') {
    if (!PROCESSOR_ROLES.has(actor.role) || !actor.permissions?.some((permission)=>['submission:write','payroll:write'].includes(permission))) {
      return { status:403, data:{ error:'Permission payroll write diperlukan', code:'PAY_RUN_REFRESH_PERMISSION_REQUIRED' } };
    }
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId,organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    if (submission.source_mode!=='MASTER_CURRENT') return { status:409, data:{ error:'Hitung ulang master hanya tersedia untuk sumber MASTER_CURRENT' } };
    if (submission.period_status==='CLOSED' || !['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','EXCEPTION_FOUND','CLIENT_ACTION_REQUIRED','CLIENT_RESUBMITTED','REVISION_REQUIRED','CLIENT_REVISION_REQUESTED'].includes(submission.state)) {
      return { status:409, data:{ error:'Snapshot Pay Run sudah terkunci dan tidak dapat dihitung ulang' } };
    }
    const before = await d1First(database, `SELECT COUNT(*) AS recipients,COALESCE(SUM(gross_amount),0) AS gross,
      COALESCE(SUM(deduction_amount),0) AS deduction,COALESCE(SUM(net_amount),0) AS net
      FROM payroll_run_lines WHERE submission_id=? AND included=1`, [submission.id]);
    await d1Batch(database, [
      { statement:`UPDATE payroll_run_lines SET included=0,updated_at=${NOW}
        WHERE submission_id=? AND NOT EXISTS(
          SELECT 1 FROM employees e WHERE e.id=payroll_run_lines.employee_id AND e.org_id=? AND e.client_id=? AND e.project_id=? AND ${ACTIVE_EMPLOYEE}
        )`, bindings:[submission.id,organizationId,submission.client_id,submission.project_id] },
      { statement:`INSERT INTO payroll_run_lines
        (id,submission_id,employee_id,employee_code,employee_name,employment_status,bank_name,account_last4,
         gross_amount,deduction_amount,net_amount,components,source,included)
        SELECT 'PRL-'||lower(hex(randomblob(16))),?,e.id,e.employee_code,e.name,e.status_aktif,
          (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1),
          (SELECT substr(account_no,-4) FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1),
          CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END,
          CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.imported_deduction,0) ELSE 0 END,
          MAX(0,(CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END)
            -(CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.imported_deduction,0) ELSE 0 END)),
          CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.payroll_components,'{}')
            ELSE json_object('Gaji Pokok',COALESCE(ec.basic_salary,0)) END,
          'MASTER_CURRENT_REFRESH_NEW',1
        FROM employees e LEFT JOIN employee_compensation ec ON ec.employee_id=e.id
        WHERE e.org_id=? AND e.client_id=? AND e.project_id=? AND ${ACTIVE_EMPLOYEE}
          AND NOT EXISTS(SELECT 1 FROM payroll_run_lines l WHERE l.submission_id=? AND l.employee_id=e.id)`,
        bindings:[submission.id,submission.period,submission.period,submission.period,submission.period,submission.period,
          organizationId,submission.client_id,submission.project_id,submission.id] },
      { statement:`UPDATE payroll_run_lines SET
          gross_amount=CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END,
          deduction_amount=CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.imported_deduction,0) ELSE 0 END,
          net_amount=MAX(0,(CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END)
            -(CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.imported_deduction,0) ELSE 0 END)),
          components=CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.payroll_components,'{}')
            ELSE json_object('Gaji Pokok',COALESCE(ec.basic_salary,0)) END,
          employment_status=(SELECT e.status_aktif FROM employees e WHERE e.id=payroll_run_lines.employee_id),
          bank_name=(SELECT eba.bank_name FROM employee_bank_accounts eba WHERE eba.employee_id=payroll_run_lines.employee_id AND eba.is_primary=1 LIMIT 1),
          account_last4=(SELECT substr(REPLACE(eba.account_no,' ',''),-4) FROM employee_bank_accounts eba WHERE eba.employee_id=payroll_run_lines.employee_id AND eba.is_primary=1 LIMIT 1),
          source='MASTER_CURRENT',updated_at=${NOW}
        FROM employee_compensation ec WHERE payroll_run_lines.submission_id=? AND payroll_run_lines.included=1
          AND ec.employee_id=payroll_run_lines.employee_id`,
        bindings:[submission.period,submission.period,submission.period,submission.period,submission.period,submission.id] },
      { statement:`UPDATE payroll_submissions SET input_status='PENDING',updated_at=${NOW} WHERE id=?`, bindings:[submission.id] },
    ]);
    const quality = await d1First(database, `SELECT COUNT(*) AS recipients,
      SUM(CASE WHEN gross_amount>0 THEN 1 ELSE 0 END) AS calculated,
      SUM(CASE WHEN gross_amount<=0 THEN 1 ELSE 0 END) AS missing_salary,
      SUM(CASE WHEN source='MASTER_CURRENT_REFRESH_NEW' THEN 1 ELSE 0 END) AS added,
      COALESCE(SUM(gross_amount),0) AS total_gross,COALESCE(SUM(deduction_amount),0) AS total_deduction,COALESCE(SUM(net_amount),0) AS total_net
      FROM payroll_run_lines WHERE submission_id=? AND included=1`, [submission.id]);
    const excluded = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_run_lines WHERE submission_id=? AND included=0
      AND source<>'MANUAL_EXCLUDE'`, [submission.id]);
    const auditDetail=JSON.stringify({
      before:{recipients:Number(before?.recipients||0),gross:Number(before?.gross||0),deduction:Number(before?.deduction||0),net:Number(before?.net||0)},
      after:{recipients:Number(quality?.recipients||0),gross:Number(quality?.total_gross||0),deduction:Number(quality?.total_deduction||0),net:Number(quality?.total_net||0)},
      added:Number(quality?.added||0),excluded:Number(excluded?.count||0),period:submission.period,
    });
    await d1Batch(database,[auditOperation(organizationId,actor,'PAY_RUN_MASTER_REFRESHED',auditDetail,'payroll_submission',submission.id)]);
    return { data:{ ok:true,summary:{recipients:Number(quality?.recipients||0),calculated:Number(quality?.calculated||0),
      missingSalary:Number(quality?.missing_salary||0),added:Number(quality?.added||0),excluded:Number(excluded?.count||0),
      totalGross:Number(quality?.total_gross||0),totalDeduction:Number(quality?.total_deduction||0),totalNet:Number(quality?.total_net||0)} } };
  }

  if (body.action === 'DELETE_PAY_RUN') {
    if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Insufficient role' } };
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId,organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    if (submission.state!=='DRAFT' || submission.period_status==='CLOSED') {
      return { status:409, data:{ error:'Hanya Pay Run DRAFT dengan periode terbuka yang dapat dihapus' } };
    }
    const protectedRecord = await d1First(database, `SELECT
      EXISTS(SELECT 1 FROM payment_instructions WHERE submission_id=?) AS has_pi,
      EXISTS(SELECT 1 FROM payroll_submissions WHERE parent_submission_id=?) AS has_child`, [submission.id,submission.id]);
    if (Number(protectedRecord?.has_pi||0)) return { status:409, data:{ error:'Pay Run sudah memiliki Payment Instruction dan tidak boleh dihapus' } };
    if (Number(protectedRecord?.has_child||0)) return { status:409, data:{ error:'Pay Run menjadi induk adjustment dan tidak boleh dihapus' } };
    await d1Batch(database, [
      { statement:'DELETE FROM payroll_exceptions WHERE submission_id=?', bindings:[submission.id] },
      { statement:'DELETE FROM submission_versions WHERE submission_id=?', bindings:[submission.id] },
      { statement:'DELETE FROM payroll_run_lines WHERE submission_id=?', bindings:[submission.id] },
      { statement:'DELETE FROM payroll_submissions WHERE id=? AND org_id=?', bindings:[submission.id,organizationId] },
      auditOperation(organizationId,actor,'PAY_RUN_DELETED',`${submission.client_id} · ${submission.project_id} · ${submission.period} · ${submission.run_type}`,'payroll_submission',submission.id),
    ]);
    return { data:{ ok:true,deletedId:submission.id } };
  }

  if (body.action === 'UPDATE_PAY_RUN_LINE') {
    if (!PROCESSOR_ROLES.has(actor.role) || !actor.permissions?.some((permission)=>['submission:write','payroll:write'].includes(permission))) {
      return { status:403, data:{ error:'Permission payroll write diperlukan', code:'PAY_RUN_LINE_WRITE_PERMISSION_REQUIRED' } };
    }
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId, organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    if (submission.period_status==='CLOSED' || !['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','EXCEPTION_FOUND','CLIENT_ACTION_REQUIRED','CLIENT_RESUBMITTED','REVISION_REQUIRED','CLIENT_REVISION_REQUESTED'].includes(submission.state)) return { status:409, data:{ error:'Snapshot Pay Run sudah terkunci' } };
    const before = await d1First(database, `SELECT * FROM payroll_run_lines WHERE submission_id=? AND employee_id=? LIMIT 1`, [body.submissionId,body.employeeId]);
    if (!before) return { status:404, data:{ error:'Karyawan tidak ditemukan pada snapshot Pay Run' } };
    const componentPayload = body.components === undefined ? before.components : JSON.stringify(body.components || {});
    const auditDetail = JSON.stringify({
      employeeId:body.employeeId,
      reason:String(body.changeReason || '').trim(),
      before:{grossAmount:Number(before.gross_amount||0),deductionAmount:Number(before.deduction_amount||0),netAmount:Number(before.net_amount||0),included:Number(before.included||0)},
      after:{grossAmount:body.grossAmount,deductionAmount:body.deductionAmount,netAmount:body.netAmount,included:body.included===false?0:1},
    });
    await d1Batch(database, [
      { statement:`UPDATE payroll_run_lines SET gross_amount=?,deduction_amount=?,net_amount=?,included=?,components=?,updated_at=${NOW}
        WHERE submission_id=? AND employee_id=?`, bindings:[body.grossAmount,body.deductionAmount,body.netAmount,
        body.included===false?0:1,componentPayload,body.submissionId,body.employeeId] },
      { statement:`UPDATE payroll_submissions SET input_status='PENDING',updated_at=${NOW} WHERE id=?`, bindings:[body.submissionId] },
      auditOperation(organizationId,actor,'PAY_RUN_LINE_CHANGED',auditDetail,'payroll_submission',body.submissionId),
    ]);
    const row = await d1First(database, `SELECT * FROM payroll_run_lines WHERE submission_id=? AND employee_id=? LIMIT 1`, [body.submissionId,body.employeeId]);
    return { data:{ ok:true,line:row } };
  }

  if (body.action === 'FINALIZE_PAY_RUN_INPUT') {
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId, organizationId]);
    if (!submission || submission.period_status==='CLOSED') return { status:409, data:{ error:'Pay Run tidak tersedia untuk finalisasi input' } };
    const inputMutableStates = ['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','EXCEPTION_FOUND','CLIENT_ACTION_REQUIRED','CLIENT_RESUBMITTED','REVISION_REQUIRED','CLIENT_REVISION_REQUESTED'];
    if (!inputMutableStates.includes(String(submission.state || ''))) return { status:409, data:{
      error:`Input payroll sudah terkunci pada tahap ${submission.state}; Controller harus meminta revisi sebelum snapshot dapat berubah`,
      code:'PAY_RUN_INPUT_LOCKED_FOR_REVIEW',
    } };
    if (!PROCESSOR_ROLES.has(actor.role) || !actor.permissions?.includes('submission:write')) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat memfinalisasi input Pay Run', code:'PAY_RUN_FINALIZE_PERMISSION_REQUIRED' } };
    if (!assertClientScope(actor, env, submission.client_id) || !assertProjectScope(actor, submission.project_id)) return { status:403, data:{ error:'Scope denied' } };
    try { await applyEwaRepayments(database, submission.id); }
    catch (error) {
      if (!/no such table|no such column/i.test(String(error?.message || error))) throw error;
    }
    // Finalisasi input is the explicit checkpoint that refreshes the visible bank
    // snapshot from the employee master. The full account is validated here and
    // fingerprinted later at Processor finalization before Controller approval.
    await d1Batch(database, [{
      statement:`UPDATE payroll_run_lines SET
        bank_name=(SELECT eba.bank_name FROM employee_bank_accounts eba WHERE eba.employee_id=payroll_run_lines.employee_id AND eba.is_primary=1 LIMIT 1),
        account_last4=(SELECT substr(REPLACE(eba.account_no,' ',''),-4) FROM employee_bank_accounts eba WHERE eba.employee_id=payroll_run_lines.employee_id AND eba.is_primary=1 LIMIT 1),
        updated_at=${NOW}
        WHERE submission_id=? AND included=1`,
      bindings:[submission.id],
    }]);
    const quality = await d1First(database, `SELECT COUNT(*) AS recipients,
      SUM(CASE WHEN gross_amount<=0 OR deduction_amount<0 OR net_amount<=0
        OR gross_amount-deduction_amount<>net_amount THEN 1 ELSE 0 END) AS invalid_control,
      SUM(CASE WHEN bank_name IS NULL OR account_last4 IS NULL OR NOT EXISTS(
        SELECT 1 FROM employee_bank_accounts eba WHERE eba.employee_id=payroll_run_lines.employee_id AND eba.is_primary=1
          AND length(REPLACE(eba.account_no,' ','')) BETWEEN 6 AND 34
          AND REPLACE(eba.account_no,' ','') NOT GLOB '*[^0-9]*'
      ) THEN 1 ELSE 0 END) AS invalid_bank,
      SUM(CASE WHEN NOT EXISTS(
        SELECT 1 FROM employees e WHERE e.id=payroll_run_lines.employee_id AND e.org_id=? AND e.client_id=? AND e.project_id=? AND ${ACTIVE_EMPLOYEE}
      ) THEN 1 ELSE 0 END) AS invalid_population
      FROM payroll_run_lines WHERE submission_id=? AND included=1`,
      [organizationId,submission.client_id,submission.project_id,submission.id]);
    const missingEligible = await d1First(database, `SELECT COUNT(*) AS count FROM employees e
      WHERE e.org_id=? AND e.client_id=? AND e.project_id=? AND ${ACTIVE_EMPLOYEE}
      AND NOT EXISTS(SELECT 1 FROM payroll_run_lines l WHERE l.submission_id=? AND l.employee_id=e.id AND l.included=1)`,
      [organizationId,submission.client_id,submission.project_id,submission.id]);
    if (!Number(quality?.recipients||0)) return { status:409, data:{ error:'Pay Run tidak memiliki penerima aktif' } };
    if (Number(quality?.invalid_control||0) || Number(quality?.invalid_bank||0)
      || Number(quality?.invalid_population||0) || Number(missingEligible?.count||0)) return { status:409, data:{
      error:`Input belum valid: ${Number(quality?.invalid_control||0)} control payroll, ${Number(quality?.invalid_bank||0)} rekening, ${Number(quality?.invalid_population||0)} penerima tidak eligible, ${Number(missingEligible?.count||0)} karyawan aktif belum masuk snapshot`,
      code:'PAY_RUN_INPUT_CONTROL_INVALID',
    } };
    await d1Batch(database, [
      { statement:`UPDATE payroll_submissions SET input_status='READY',updated_at=${NOW} WHERE id=?`, bindings:[submission.id] },
      auditOperation(organizationId,actor,'PAY_RUN_INPUT_FINALIZED',`${quality.recipients} penerima tervalidasi`,'payroll_submission',submission.id),
    ]);
    return { data:{ ok:true,inputStatus:'READY',recipients:Number(quality.recipients) } };
  }

  // High-level workflow commands keep the audit/control points while removing
  // status-only clicks (INGESTING, AI_VALIDATING, STANDARDIZED, DATA_APPROVED).
  if (body.action === 'ADVANCE_PAY_RUN') {
    const submission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    if (!assertClientScope(actor, env, submission.client_id) || !assertProjectScope(actor, submission.project_id)) return { status:403, data:{ error:'Scope denied' } };
    if (submission.period_status === 'CLOSED') return { status:409, data:{ error:'Periode Pay Run sudah ditutup' } };

    const blocking = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_exceptions WHERE submission_id=?
      AND severity='CRITICAL' AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`, [submission.id]);
    let blockingCount = Number(blocking?.count || 0);
    let targetState;
    let reviewFields = '';
    const bindings = [];

    if (body.command === 'VALIDATE') {
      if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat menjalankan validasi' } };
      if (!['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','CLIENT_RESUBMITTED','REVISION_REQUIRED','CLIENT_REVISION_REQUESTED','EXCEPTION_FOUND'].includes(submission.state)) {
        return { status:409, data:{ error:`Pay Run berstatus ${submission.state} tidak dapat divalidasi ulang` } };
      }
      if (submission.input_status !== 'READY') return { status:409, data:{ error:'Finalisasi input payroll sebelum menjalankan validasi' } };
      await validateCanonicalPayRunSnapshot(database, submission, actor, organizationId);
      const refreshedBlocking = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_exceptions WHERE submission_id=?
        AND severity='CRITICAL' AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`, [submission.id]);
      blockingCount = Number(refreshedBlocking?.count || 0);
      targetState = blockingCount ? 'EXCEPTION_FOUND' : 'VALIDATED';
    } else if (body.command === 'FINALIZE_PAYROLL') {
      if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat memfinalisasi payroll' } };
      if (!['VALIDATED','STANDARDIZED'].includes(submission.state)) return { status:409, data:{ error:'Pay Run harus selesai divalidasi sebelum difinalisasi' } };
      if (blockingCount) return { status:409, data:{ error:`${blockingCount} critical exception masih terbuka` } };
      // Processor finalization must stop at Controller review. PI creation is a separate
      // Controller checkpoint so payroll data cannot bypass maker-checker segregation.
      targetState = 'CONTROLLER_REVIEW';
      reviewFields = `,processor_reviewed_at=${NOW},processor_reviewed_by=?,processor_review_note=?`;
      bindings.push(actor.email, String(body.reviewNote || '').slice(0,1000));
    } else {
      return { status:422, data:{ error:'Command workflow tidak didukung' } };
    }

    bindings.unshift(targetState);
    bindings.push(submission.id);
    await d1Batch(database, [
      { statement:`UPDATE payroll_submissions SET state=?,updated_at=${NOW}${reviewFields} WHERE id=?`, bindings },
      auditOperation(organizationId,actor,'PAY_RUN_ADVANCED',`${body.command}: ${submission.state} → ${targetState}`,'payroll_submission',submission.id),
    ]);
    const updated = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=?', [submission.id]);
    return { data:{ ok:true,submission:updated,blockingCount } };
  }

  if (body.action === 'CLOSE_PAY_RUN') {
    if (!CONTROLLER_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Controller yang dapat menutup periode' } };
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId, organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    const readiness = await getCloseReadiness(database, organizationId, submission);
    if (submission.period_status === 'CLOSED') {
      return { data:{ ok:true,submission,readiness:{...readiness,ready:true},idempotentReplay:true } };
    }
    if (!readiness.ready) return { status:409, data:{
      error:'Pay Run belum memenuhi close readiness. Selesaikan payment, rekonsiliasi, dan penerbitan invoice terlebih dahulu.',
      code:'CLOSE_READINESS_REQUIRED',
      readiness,
    } };
    await d1Batch(database, [
      { statement:`UPDATE payroll_submissions SET period_status='CLOSED',closed_at=${NOW},closed_by=?,updated_at=${NOW} WHERE id=? AND period_status='OPEN'`,
        bindings:[actor.email,submission.id] },
      auditOperation(organizationId,actor,'PAY_RUN_CLOSED',
        `Payment ${readiness.paymentStatus} · reconciliation ${readiness.reconciliationStatus} · invoice ${readiness.invoiceStatus}`,
        'payroll_submission',submission.id),
    ]);
    const row = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=?', [submission.id]);
    return { data:{ ok:true,submission:row,readiness } };
  }

  if (body.action === 'REOPEN_PAY_RUN') {
    if (!CONTROLLER_ROLES.has(actor.role)) return { status:403, data:{ error:'Insufficient role' } };
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId, organizationId]);
    if (!submission || submission.period_status!=='CLOSED') return { status:409, data:{ error:'Periode tidak sedang ditutup' } };
    const payment = await d1First(database, `SELECT id FROM payment_instructions WHERE submission_id=? LIMIT 1`, [submission.id]);
    if (payment || submission.state==='COMPLETED') return { status:409, data:{ error:'Periode dengan PI atau pembayaran tidak boleh dibuka kembali; buat adjustment Pay Run' } };
    await d1Batch(database, [
      { statement:`UPDATE payroll_submissions SET period_status='OPEN',input_status='PENDING',state='REVISION_REQUIRED',closed_at=NULL,closed_by=NULL,reopen_reason=?,updated_at=${NOW} WHERE id=? RETURNING *`, bindings:[String(body.reason).trim(),submission.id] },
      auditOperation(organizationId,actor,'PAY_RUN_REOPENED',String(body.reason).trim(),'payroll_submission',submission.id),
    ]);
    const reopened = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=?', [submission.id]);
    return { data:{ ok:true,submission:reopened } };
  }

  if (body.action === 'TRANSITION_SUBMISSION') {
    const submission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!submission) return { status: 404, data: { error: 'Submission not found' } };
    if (!assertClientScope(actor, env, submission.client_id) || !assertProjectScope(actor, submission.project_id)) return { status: 403, data: { error: 'Scope denied' } };
    const targetState = resolveTierTransition(submission.service_tier, submission.state, body.toState);
    if (!canTransition(submission.state, targetState)) return { status: 409, data: { error: `Invalid transition ${submission.state} → ${targetState}` } };
    if (submission.state === 'DRAFT' && targetState === 'SUBMITTED' && submission.input_status === 'PENDING') {
      return { status:409, data:{ error:'Input payroll belum final. Lengkapi perubahan bulanan dan finalisasi data terlebih dahulu.' } };
    }
    if (submission.service_tier === 'TIER_1_PAYMENT_PROCESSING' && ['INGESTING','PAYROLL_FINALIZED'].includes(targetState)) {
      return { status: 409, data: { error: 'Tier 1 langsung menggunakan data final klien tanpa kalkulasi ulang' } };
    }
    if (!roleAllowsTransition(actor.role, submission.state, targetState)) return { status: 403, data: { error: 'Role cannot perform transition' } };
    const processorReview = submission.state === 'STANDARDIZED' && targetState === 'CONTROLLER_REVIEW';
    const controllerReview = submission.state === 'CONTROLLER_REVIEW' && targetState === 'CLIENT_APPROVAL_PENDING';
    if ((processorReview || controllerReview) && body.reviewConfirmed !== true) return { status: 409, data: { error: 'Preview dan konfirmasi review wajib dilakukan sebelum melanjutkan' } };
    if (controllerReview && submission.processor_reviewed_by
      && String(submission.processor_reviewed_by).toLowerCase() === String(actor.email || '').toLowerCase()) {
      return { status:409, data:{ error:'Processor reviewer tidak boleh menyetujui payroll yang sama sebagai Controller', code:'PAYROLL_REVIEW_SOD' } };
    }
    if (['VALIDATED','DATA_APPROVED','PAYROLL_FINALIZED','CLIENT_APPROVAL_PENDING','CLIENT_APPROVED','APPROVED_FOR_PAYMENT'].includes(targetState)) {
      const blocking = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_exceptions WHERE submission_id=?
        AND severity='CRITICAL' AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`, [submission.id]);
      if (Number(blocking?.count || 0) > 0) return { status: 409, data: { error: 'Critical exceptions still open' } };
    }
    let update = `UPDATE payroll_submissions SET state=?,updated_at=${NOW}`;
    const bindings = [targetState];
    if (processorReview) { update += `,processor_reviewed_at=${NOW},processor_reviewed_by=?,processor_review_note=?`; bindings.push(actor.email, String(body.reviewNote || '').slice(0, 1000)); }
    if (controllerReview) {
      update += `,controller_reviewed_at=${NOW},controller_reviewed_by=?,controller_review_note=?,client_reviewed_at=NULL,client_reviewed_by=NULL,client_review_note=NULL,client_review_decision=NULL`;
      bindings.push(actor.email, String(body.reviewNote || '').slice(0, 1000));
    }
    update += ' WHERE id=? RETURNING *'; bindings.push(submission.id);
    await d1Batch(database, [
      { statement: update, bindings },
      auditOperation(organizationId, actor, controllerReview ? 'PAYROLL_SENT_FOR_CLIENT_APPROVAL' : 'SUBMISSION_TRANSITION',
        `${submission.state} → ${targetState}${controllerReview && body.reviewNote ? ` · ${String(body.reviewNote).slice(0,1000)}` : ''}`,
        'payroll_submission', submission.id),
    ]);
    const updatedSubmission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=?', [submission.id]);
    return { data: { ok: true, submission: updatedSubmission } };
  }

  if (body.action === 'CLIENT_APPROVE_PAYROLL' || body.action === 'CLIENT_REQUEST_PAYROLL_REVISION') {
    if (!CLIENT_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Client User yang dapat memberikan keputusan approval client' } };
    const submission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    if (!assertClientScope(actor, env, submission.client_id) || !assertProjectScope(actor, submission.project_id)) return { status:403, data:{ error:'Scope denied' } };
    if (submission.period_status === 'CLOSED') return { status:409, data:{ error:'Periode Pay Run sudah ditutup' } };

    if (body.action === 'CLIENT_APPROVE_PAYROLL' && submission.state === 'CLIENT_APPROVED') {
      return { data:{ ok:true,submission,idempotentReplay:true } };
    }
    if (body.action === 'CLIENT_REQUEST_PAYROLL_REVISION' && submission.state === 'CLIENT_REVISION_REQUESTED') {
      return { data:{ ok:true,submission,idempotentReplay:true } };
    }
    if (submission.state !== 'CLIENT_APPROVAL_PENDING') return { status:409, data:{
      error:`Payroll berstatus ${submission.state || 'UNKNOWN'} tidak sedang menunggu keputusan client`,
      code:'CLIENT_APPROVAL_STATE_REQUIRED',
    } };
    if (!submission.controller_reviewed_by) return { status:409, data:{
      error:'Approval Controller belum tercatat; client approval diblokir',
      code:'CONTROLLER_APPROVAL_REQUIRED',
    } };
    const blocking = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_exceptions WHERE submission_id=?
      AND severity='CRITICAL' AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`, [submission.id]);
    if (Number(blocking?.count || 0) > 0) return { status:409, data:{ error:'Critical exceptions still open', code:'CRITICAL_EXCEPTION_BLOCKS_CLIENT_APPROVAL' } };

    if (body.action === 'CLIENT_APPROVE_PAYROLL') {
      await d1Batch(database, [
        { statement:`UPDATE payroll_submissions SET state='CLIENT_APPROVED',
            client_reviewed_at=${NOW},client_reviewed_by=?,client_review_note=?,client_review_decision='APPROVED',updated_at=${NOW}
            WHERE id=? AND state='CLIENT_APPROVAL_PENDING'`,
          bindings:[actor.email,String(body.reviewNote || '').slice(0,1000),submission.id] },
        auditOperation(organizationId,actor,'CLIENT_PAYROLL_APPROVED',
          `Payroll ${submission.period} disetujui client${body.reviewNote ? ` · ${String(body.reviewNote).slice(0,1000)}` : ''}`,
          'payroll_submission',submission.id),
      ]);
    } else {
      await d1Batch(database, [
        { statement:`UPDATE payroll_submissions SET state='CLIENT_REVISION_REQUESTED',input_status='PENDING',
            client_reviewed_at=${NOW},client_reviewed_by=?,client_review_note=?,client_review_decision='REVISION_REQUESTED',updated_at=${NOW}
            WHERE id=? AND state='CLIENT_APPROVAL_PENDING'`,
          bindings:[actor.email,String(body.reason).trim().slice(0,1000),submission.id] },
        auditOperation(organizationId,actor,'CLIENT_PAYROLL_REVISION_REQUESTED',
          String(body.reason).trim().slice(0,1000),'payroll_submission',submission.id),
      ]);
    }
    const updated = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=?', [submission.id]);
    return { data:{ ok:true,submission:updated } };
  }

  if (body.action === 'UPDATE_SUBMISSION_PERIODS') {
    if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat mengubah periode pembayaran dan rapel' } };
    const current = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!current) return { status: 404, data: { error: 'Submission not found' } };
    if (!assertClientScope(actor, env, current.client_id) || !assertProjectScope(actor, current.project_id)) return { status: 403, data: { error: 'Scope denied' } };
    const mutableStates = ['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','EXCEPTION_FOUND','CLIENT_ACTION_REQUIRED','CLIENT_RESUBMITTED','VALIDATED','STANDARDIZED','REVISION_REQUIRED','CLIENT_REVISION_REQUESTED'];
    if (current.period_status==='CLOSED' || !mutableStates.includes(String(current.state || ''))) {
      return { status:409, data:{
        error:'Periode pembayaran dan rapel terkunci setelah Pay Run masuk review/approval. Minta revisi terlebih dahulu bila terms pembayaran harus berubah.',
        code:'PAYMENT_TERMS_LOCKED_AFTER_REVIEW',
      } };
    }
    const arrears = [...new Set(body.arrearsPeriods.map(String))].filter((p) => p !== current.period && p !== body.paymentPeriod);
    const previousArrears = typeof current.arrears_periods === 'string' ? current.arrears_periods : JSON.stringify(current.arrears_periods || []);
    await d1Batch(database, [
      { statement:`UPDATE payroll_submissions SET payment_period=?,payment_date=?,arrears_periods=?,updated_at=${NOW} WHERE id=?`,
        bindings:[body.paymentPeriod,body.paymentDate,JSON.stringify(arrears),body.submissionId] },
      auditOperation(organizationId,actor,'PAY_RUN_PAYMENT_TERMS_CHANGED',
        JSON.stringify({before:{paymentPeriod:current.payment_period,paymentDate:current.payment_date,arrearsPeriods:previousArrears},after:{paymentPeriod:body.paymentPeriod,paymentDate:body.paymentDate,arrearsPeriods:arrears}}),
        'payroll_submission',body.submissionId),
    ]);
    const row = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? LIMIT 1', [body.submissionId]);
    return { data: { ok: true, submission: row } };
  }

  if (body.action === 'APPROVE_PAYROLL_AND_GENERATE_PI') {
    return { status:409, data:{
      error:'Controller approval tidak boleh langsung membuat PI. Payroll wajib disetujui Client terlebih dahulu.',
      code:'CLIENT_PAYROLL_APPROVAL_REQUIRED',
    } };
  }

  if (body.action === 'GENERATE_PAYMENT_INSTRUCTION') {
    if (!PROCESSOR_ROLES.has(actor.role) || !actor.permissions?.includes('payment:prepare')) {
      return { status:403, data:{ error:'Hanya Payroll Processor dengan izin payment:prepare yang dapat membuat PI', code:'PAYMENT_PREPARE_PERMISSION_REQUIRED' } };
    }
    const submission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!submission) return { status: 404, data: { error: 'Submission not found' } };
    const existing = await d1First(database, `SELECT * FROM payment_instructions
      WHERE submission_id=? AND org_id=? AND status<>'REJECTED' ORDER BY created_at DESC LIMIT 1`, [submission.id, organizationId]);
    if (['DATA_APPROVED','PAYROLL_FINALIZED'].includes(String(submission.state || ''))) {
      await d1Batch(database, [
        { statement:`UPDATE payroll_submissions SET state='CLIENT_APPROVAL_PENDING',updated_at=${NOW} WHERE id=? AND state=?`,
          bindings:[submission.id,submission.state] },
        auditOperation(organizationId,actor,'PAYMENT_INSTRUCTION_LEGACY_RECOVERY',
          `${submission.state} dipulihkan ke CLIENT_APPROVAL_PENDING; client payroll approval tidak boleh dilewati`,
          'payroll_submission',submission.id),
      ]);
      return { status:409, data:{
        error:'Pay Run legacy dipulihkan ke Client Approval. Selesaikan approval payroll Client sebelum membuat Payment Instruction.',
        code:'CLIENT_PAYROLL_APPROVAL_REQUIRED',
        recoveredState:'CLIENT_APPROVAL_PENDING',
      } };
    }
    const expectedStates = ['CLIENT_APPROVED','PAYMENT_INSTRUCTION_READY'];
    if (!expectedStates.includes(submission.state)) return { status:409, data:{
      error:'Submission belum memiliki approval Client atau belum siap dibuatkan payment instruction',
      code:'CLIENT_PAYROLL_APPROVAL_REQUIRED',
    } };
    const clientApprovalEvidence = submission.client_review_decision === 'APPROVED' && Boolean(submission.client_reviewed_by);
    if (!clientApprovalEvidence) {
      if (submission.state === 'PAYMENT_INSTRUCTION_READY' && !existing) {
        await d1Batch(database, [
          { statement:`UPDATE payroll_submissions SET state='CLIENT_APPROVAL_PENDING',updated_at=${NOW} WHERE id=? AND state='PAYMENT_INSTRUCTION_READY'`, bindings:[submission.id] },
          auditOperation(organizationId,actor,'PAYMENT_INSTRUCTION_ORPHAN_RECOVERY',
            'PAYMENT_INSTRUCTION_READY tanpa PI/approval evidence dipulihkan ke CLIENT_APPROVAL_PENDING',
            'payroll_submission',submission.id),
        ]);
        return { status:409, data:{
          error:'Payment Instruction orphan terdeteksi. Pay Run dipulihkan ke Client Approval untuk menjaga approval evidence.',
          code:'CLIENT_APPROVAL_EVIDENCE_REQUIRED',
          recoveredState:'CLIENT_APPROVAL_PENDING',
        } };
      }
      return { status:409, data:{
        error:'Bukti approval Client belum lengkap; Payment Instruction diblokir',
        code:'CLIENT_APPROVAL_EVIDENCE_REQUIRED',
      } };
    }
    const recoveringOrphan = submission.state === 'PAYMENT_INSTRUCTION_READY' && !existing;
    const blocking = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_exceptions WHERE submission_id=?
      AND severity='CRITICAL' AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`, [submission.id]);
    if (Number(blocking?.count || 0) > 0) return { status:409, data:{
      error:'Critical exceptions still open',
      code:'CRITICAL_EXCEPTION_BLOCKS_PI',
    } };
    if (existing && existing.status !== 'REVISION_REQUIRED') return { data: { ok: true, paymentInstruction: existing, idempotentReplay: true } };
    const snapshotCount = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_run_lines WHERE submission_id=?`, [submission.id]);
    const source = Number(snapshotCount?.count || 0) ? await d1All(database, `SELECT l.employee_id AS id,l.employee_name AS name,l.net_amount AS amount,
      eba.bank_name,eba.account_no,l.account_last4,
      pbs.bank_name AS snapshot_bank_name,pbs.account_last4 AS snapshot_account_last4,pbs.account_fingerprint
      FROM payroll_run_lines l
      LEFT JOIN employee_bank_accounts eba ON eba.employee_id=l.employee_id AND eba.is_primary=1
      LEFT JOIN payroll_bank_snapshots pbs ON pbs.submission_id=l.submission_id AND pbs.employee_id=l.employee_id
      WHERE l.submission_id=? AND l.included=1 ORDER BY l.employee_name`, [submission.id])
      : await d1All(database, `SELECT e.id,e.name,COALESCE(ec.imported_net,0) AS amount,
        (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS bank_name,
        (SELECT account_no FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS account_no,
        (SELECT substr(account_no,-4) FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS account_last4
        FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id WHERE e.client_id=?
        AND (? IS NULL OR e.project_id=?) AND ec.payroll_source_period=? ORDER BY e.name`,
        [submission.client_id, submission.project_id || null, submission.project_id || null, submission.period]);
    if (!source.length) return { status: 409, data: { error: 'Tidak ada data payroll final untuk periode submission' } };
    const invalid = source.filter((row) => Number(row.amount || 0) <= 0 || !row.bank_name || !/^\d{6,34}$/.test(String(row.account_no || '').replace(/\s+/g,'')));
    if (invalid.length) return { status: 409, data: { error: `${invalid.length} karyawan belum memiliki THP atau rekening bank yang valid` } };
    const changedAccounts = source.filter((row) => row.account_last4 && String(row.account_no).replace(/\s+/g,'').slice(-4) !== String(row.account_last4));
    if (changedAccounts.length) return { status:409, data:{ error:`${changedAccounts.length} rekening berubah setelah snapshot; review dan finalisasi ulang Pay Run diperlukan`, code:'PAY_RUN_BANK_LAST4_CHANGED' } };
    if (Number(snapshotCount?.count || 0)) {
      const changedBankSnapshots = [];
      const missingBankSnapshots = [];
      for (const row of source) {
        const account = String(row.account_no || '').replace(/\s+/g,'');
        const fingerprint = await sha256Hex(`${String(row.bank_name || '').trim().toUpperCase()}|${account}`);
        if (!row.account_fingerprint || !row.snapshot_account_last4) {
          missingBankSnapshots.push({row,account,fingerprint});
          continue;
        }
        if (fingerprint !== row.account_fingerprint || account.slice(-4) !== String(row.snapshot_account_last4)) changedBankSnapshots.push(row.id);
      }
      if (changedBankSnapshots.length) return { status:409, data:{
        error:`${changedBankSnapshots.length} rekening berubah setelah snapshot; review dan finalisasi ulang Pay Run diperlukan`,
        code:'BANK_SNAPSHOT_CHANGED',
      } };
      if (missingBankSnapshots.length) {
        await d1Batch(database, [
          ...missingBankSnapshots.map(({row,account,fingerprint}) => ({
            statement:`INSERT INTO payroll_bank_snapshots
              (submission_id,employee_id,bank_name,account_last4,account_fingerprint,captured_at)
              VALUES (?,?,?,?,?,${NOW}) ON CONFLICT(submission_id,employee_id) DO NOTHING`,
            bindings:[submission.id,row.id,String(row.bank_name),account.slice(-4),fingerprint],
          })),
          auditOperation(organizationId,actor,'PAYMENT_INSTRUCTION_BANK_SNAPSHOT_BACKFILLED',
            `${missingBankSnapshots.length} legacy bank snapshot(s) backfilled after account last-4 verification`,
            'payroll_submission',submission.id),
        ]);
      }
    }
    if (!env.PI_ENCRYPTION_KEY || String(env.PI_ENCRYPTION_KEY).length < 32) return { status: 503, data: { error: 'PI_ENCRYPTION_KEY belum dikonfigurasi dengan aman' } };
    const expectedTotal = source.reduce((sum, row) => sum + Number(row.amount), 0);
    const billingProfile = await d1First(database, `SELECT billing_method,billing_rate,billing_admin_fee,billing_tax_rate,
      tax_status,payment_terms_days,purchase_order FROM clients WHERE id=? AND org_id=? LIMIT 1`,
      [submission.client_id, organizationId]);
    if (!billingProfile) return { status:404, data:{ error:'Client billing profile tidak ditemukan' } };
    const billingSnapshot = JSON.stringify({
      method:String(billingProfile.billing_method || 'PER_EMPLOYEE'),
      rate:Number(billingProfile.billing_rate || 0),
      adminFee:Number(billingProfile.billing_admin_fee || 0),
      taxRate:Number(billingProfile.billing_tax_rate || 0),
      taxStatus:String(billingProfile.tax_status || 'NON_PKP'),
      paymentTermsDays:Number(billingProfile.payment_terms_days || 0),
      purchaseOrder:billingProfile.purchase_order || null,
      capturedAt:new Date().toISOString(),
    });
    const id = `PI-${crypto.randomUUID()}`;
    const paymentPeriod = submission.payment_period || submission.period;
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
    if (existing?.content_hash === contentHash) {
      await d1Batch(database, [
        { statement:`UPDATE payment_instructions SET status='PAYMENT_INSTRUCTION_READY',creator_user_id=?,updated_at=${NOW} WHERE id=? AND status='REVISION_REQUIRED'`, bindings:[actor.id,existing.id] },
        { statement:`UPDATE payroll_submissions SET state='PAYMENT_INSTRUCTION_READY',updated_at=${NOW} WHERE id=?`, bindings:[submission.id] },
        auditOperation(organizationId, actor, 'PAYMENT_INSTRUCTION_REVIEWED_UNCHANGED',
          'Processor mengonfirmasi snapshot PI tetap benar setelah meninjau alasan reject', 'payment_instruction', existing.id),
      ]);
      return { data:{ ok:true,paymentInstruction:await d1First(database,'SELECT * FROM payment_instructions WHERE id=?',[existing.id]),reviewedUnchanged:true } };
    }
    const revision = await d1First(database, 'SELECT COUNT(*) AS count FROM payment_instructions WHERE submission_id=? AND org_id=?', [submission.id, organizationId]);
    const revisionNo = Number(revision?.count || 0) + 1;
    const idempotencyKey = `${`PI-${submission.id}-${paymentPeriod}`.slice(0, 105)}${revisionNo > 1 ? `-R${revisionNo}` : ''}`;
    const documentNo = `PI/${paymentPeriod.replace('-','')}/${contentHash.slice(0,10).toUpperCase()}`;
    try {
      await d1Batch(database, [
        ...(existing ? [{ statement:`UPDATE payment_instructions SET status='REJECTED',updated_at=${NOW} WHERE id=? AND status='REVISION_REQUIRED'`, bindings:[existing.id] }] : []),
        { statement: `INSERT INTO payment_instructions
          (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,
           document_no,content_hash,currency,execution_date,recipient_count,billing_snapshot)
          VALUES (?,?,?,?,'PAYMENT_INSTRUCTION_READY',?,?,?,?,?,'IDR',?,?,?)`,
          bindings: [id, organizationId, submission.client_id, submission.id, expectedTotal, actor.id, idempotencyKey,
            documentNo, contentHash, `${paymentPeriod}-01`, snapshotLines.length, billingSnapshot] },
        ...lineInsertOperations(id, snapshotLines),
        { statement:`UPDATE payroll_submissions SET state='PAYMENT_INSTRUCTION_READY',updated_at=${NOW} WHERE id=?`,
          bindings:[submission.id] },
        auditOperation(organizationId, actor, existing ? 'PAYMENT_INSTRUCTION_REVISED' : recoveringOrphan ? 'PAYMENT_INSTRUCTION_ORPHAN_REGENERATED' : 'PAYMENT_INSTRUCTION_CREATED', `${documentNo} · revisi ${revisionNo} · ${snapshotLines.length} penerima · ${contentHash}`, 'payment_instruction', id),
      ]);
    } catch (error) {
      if (/UNIQUE constraint failed|constraint failed/i.test(String(error?.message || error))) {
        const canonical = await d1First(database, `SELECT * FROM payment_instructions
          WHERE submission_id=? AND org_id=? AND status<>'REJECTED'
          ORDER BY updated_at DESC,created_at DESC LIMIT 1`, [submission.id, organizationId]);
        if (canonical?.content_hash === contentHash) {
          return { data:{ ok:true,paymentInstruction:canonical,idempotentReplay:true,concurrentReplay:true } };
        }
      }
      throw error;
    }
    const paymentInstruction = await d1First(database, 'SELECT * FROM payment_instructions WHERE id=?', [id]);
    return { status: 201, data: { ok: true, paymentInstruction } };
  }

  if (body.action === 'SUBMIT_PAYMENT_INSTRUCTION') {
    if (!PROCESSOR_ROLES.has(actor.role) || !actor.permissions?.includes('payment:prepare')) {
      return { status:403, data:{ error:'Hanya Payroll Processor dengan izin payment:prepare yang dapat submit PI', code:'PAYMENT_PREPARE_PERMISSION_REQUIRED' } };
    }
    const payment = await d1First(database, `SELECT * FROM payment_instructions WHERE id=? AND org_id=? LIMIT 1`, [body.paymentInstructionId, organizationId]);
    if (!payment) return { status:404, data:{ error:'Payment instruction tidak ditemukan' } };
    if (payment.status !== 'PAYMENT_INSTRUCTION_READY') return { status:409, data:{ error:'PI tidak berada pada status siap submit' } };
    await d1Batch(database, [
      { statement:`UPDATE payment_instructions SET status='PAYMENT_APPROVAL_PENDING',creator_user_id=?,updated_at=${NOW} WHERE id=?`, bindings:[actor.id,payment.id] },
      { statement:`UPDATE payroll_submissions SET state='PAYMENT_APPROVAL_PENDING',updated_at=${NOW} WHERE id=?`, bindings:[payment.submission_id] },
      auditOperation(organizationId, actor, 'PAYMENT_INSTRUCTION_SUBMITTED', 'PI dikirim ke Controller untuk approval', 'payment_instruction', payment.id),
    ]);
    return { data:{ ok:true,paymentInstruction:await d1First(database,'SELECT * FROM payment_instructions WHERE id=?',[payment.id]) } };
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
    if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat membuat validation batch' } };
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
    const current = await d1First(database, `SELECT e.*,s.client_id,s.project_id,s.state AS submission_state FROM payroll_exceptions e
      JOIN payroll_submissions s ON s.id=e.submission_id WHERE e.id=? AND s.org_id=? LIMIT 1`,
      [body.exceptionId, organizationId]);
    if (!current) return { status: 404, data: { error: 'Exception not found' } };
    if (!assertClientScope(actor, env, current.client_id) || !assertProjectScope(actor, current.project_id)) return { status: 403, data: { error: 'Scope denied' } };

    const clientAction = actor.role === 'CLIENT_USER';
    if (clientAction) {
      if (!['ADD_EXCEPTION_NOTE','RESOLVE_EXCEPTION'].includes(body.action)) return { status:403, data:{ error:'Client User hanya dapat memberi catatan atau mengonfirmasi perbaikan exception' } };
      if (body.action === 'RESOLVE_EXCEPTION' && (body.status !== 'ACCEPTED' || current.status !== 'CLIENT_ACTION_REQUIRED')) {
        return { status:409, data:{ error:'Client hanya dapat mengonfirmasi exception yang sedang menunggu perbaikan klien', code:'CLIENT_EXCEPTION_STATE_REQUIRED' } };
      }
    } else {
      if (!actor.permissions?.includes('exception:write')) {
        return { status:403, data:{ error:'Permission exception:write diperlukan', code:'EXCEPTION_WRITE_PERMISSION_REQUIRED' } };
      }
      if (body.action === 'RESOLVE_EXCEPTION' && body.status !== 'RESOLVED') {
        return { status:422, data:{ error:'Operator internal hanya dapat menutup exception sebagai RESOLVED', code:'INTERNAL_EXCEPTION_RESOLUTION_INVALID' } };
      }
    }

    let row;
    if (body.action === 'RESOLVE_EXCEPTION') {
      row = await d1First(database, `UPDATE payroll_exceptions SET status=?,resolution_note=?,resolved_at=${NOW},resolved_by=?
        WHERE id=? RETURNING *`, [body.status, body.resolutionNote, actor.email, body.exceptionId]);

      const auditAction = clientAction ? 'CLIENT_EXCEPTION_ACCEPTED' : 'PAYROLL_EXCEPTION_RESOLVED';
      await d1Batch(database, [
        auditOperation(
          organizationId,
          actor,
          auditAction,
          `${current.category || 'VALIDATION'} · ${current.severity || 'UNKNOWN'} · ${String(body.resolutionNote || '').slice(0,1000)}`,
          'payroll_exception',
          current.id,
        ),
      ]);

      if (clientAction && body.status === 'ACCEPTED' && current.submission_state === 'CLIENT_ACTION_REQUIRED') {
        const remaining = await d1First(database, `SELECT
          SUM(CASE WHEN status='CLIENT_ACTION_REQUIRED' AND id<>? THEN 1 ELSE 0 END) AS client_pending,
          SUM(CASE WHEN status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED') AND id<>? THEN 1 ELSE 0 END) AS unresolved
          FROM payroll_exceptions WHERE submission_id=?`,
          [current.id, current.id, current.submission_id]);
        if (Number(remaining?.client_pending || 0) === 0) {
          const nextState = Number(remaining?.unresolved || 0) > 0 ? 'EXCEPTION_FOUND' : 'CLIENT_RESUBMITTED';
          await d1Batch(database, [
            { statement:`UPDATE payroll_submissions SET state=?,updated_at=${NOW} WHERE id=? AND state='CLIENT_ACTION_REQUIRED'`, bindings:[nextState,current.submission_id] },
            auditOperation(
              organizationId,
              actor,
              nextState === 'CLIENT_RESUBMITTED' ? 'CLIENT_PAYROLL_CORRECTION_CONFIRMED' : 'CLIENT_CORRECTION_COMPLETED_INTERNAL_ISSUES_REMAIN',
              nextState === 'CLIENT_RESUBMITTED'
                ? 'Semua exception client action telah dikonfirmasi dan tidak ada exception unresolved lain'
                : `${Number(remaining?.unresolved || 0)} exception internal masih unresolved setelah koreksi client`,
              'payroll_submission',
              current.submission_id,
            ),
          ]);
        }
      }
    } else {
      const status = body.action === 'REQUEST_CLIENT_ACTION' ? 'CLIENT_ACTION_REQUIRED' : current.status;
      const owner = body.action === 'REQUEST_CLIENT_ACTION' ? 'CLIENT_USER' : current.owner;
      const note = `${current.resolution_note ? `${current.resolution_note}\n` : ''}[${new Date().toISOString()}] ${actor.email}: ${String(body.message).slice(0,1000)}`;
      row = await d1First(database, 'UPDATE payroll_exceptions SET status=?,owner=?,resolution_note=? WHERE id=? RETURNING *',
        [status, owner, note, body.exceptionId]);
      await d1Batch(database, [
        auditOperation(
          organizationId,
          actor,
          body.action === 'REQUEST_CLIENT_ACTION' ? 'PAYROLL_EXCEPTION_CLIENT_ACTION_REQUESTED' : 'PAYROLL_EXCEPTION_NOTE_ADDED',
          String(body.message).slice(0,1000),
          'payroll_exception',
          current.id,
        ),
      ]);
      if (body.action === 'REQUEST_CLIENT_ACTION' && current.submission_state === 'EXCEPTION_FOUND') {
        await d1Batch(database, [
          { statement:`UPDATE payroll_submissions SET state='CLIENT_ACTION_REQUIRED',updated_at=${NOW} WHERE id=? AND state='EXCEPTION_FOUND'`, bindings:[current.submission_id] },
          auditOperation(organizationId, actor, 'CLIENT_ACTION_REQUESTED', String(body.message).slice(0,1000), 'payroll_submission', current.submission_id),
        ]);
      }
    }
    return { data: { ok: true, exception: row } };
  }

  if (body.action === 'CREATE_PAYMENT_INSTRUCTION') {
    return { status: 410, data: { error: 'Workflow payment instruction lama telah dinonaktifkan',
      code: 'LEGACY_PI_WORKFLOW_DISABLED', replacementAction: 'GENERATE_PAYMENT_INSTRUCTION' } };
  }

  if (body.action === 'APPROVE_PAYMENT') {
    if (!CONTROLLER_ROLES.has(actor.role) || !actor.permissions?.includes('payment:approve')) {
      return { status: 403, data: { error: 'Hanya Payroll Controller dengan izin payment:approve yang dapat approve PI', code:'PAYMENT_APPROVE_PERMISSION_REQUIRED' } };
    }
    const payment = await d1First(database, `SELECT pi.*,s.period AS payroll_period,COALESCE(s.payment_period,s.period) AS payment_period,
      COALESCE((SELECT SUM(amount) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id),0) AS instruction_total,
      COALESCE((SELECT COUNT(*) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id),0) AS instruction_count
      FROM payment_instructions pi JOIN payroll_submissions s ON s.id=pi.submission_id
      WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [body.paymentInstructionId, organizationId]);
    if (!payment) return { status: 404, data: { error: 'Payment instruction not found' } };
    if (payment.status !== 'PAYMENT_APPROVAL_PENDING') return { status:409, data:{ error:'PI belum disubmit atau tidak lagi menunggu approval' } };
    if (String(payment.creator_user_id) === String(actor.id)) return { status: 409, data: { error: 'Maker cannot approve the same payment instruction' } };
    if (Number(payment.instruction_total) !== Number(payment.expected_total)) return { status: 409, data: { error: 'Payment total mismatch blocks approval', code:'PI_CONTROL_TOTAL_MISMATCH' } };
    if (Number(payment.instruction_count) !== Number(payment.recipient_count)) return { status: 409, data: { error: 'Recipient count snapshot tidak sesuai; approval diblokir', code:'PI_RECIPIENT_COUNT_MISMATCH' } };
    if (!payment.content_hash || body.actionHash !== payment.content_hash) return { status: 409, data: { error: 'Content hash payment berubah atau tidak sesuai preview', code:'PI_ACTION_HASH_MISMATCH' } };
    if (!env.PI_ENCRYPTION_KEY || String(env.PI_ENCRYPTION_KEY).length < 32) {
      return { status:503, data:{ error:'PI_ENCRYPTION_KEY belum dikonfigurasi dengan aman', code:'PI_ENCRYPTION_KEY_REQUIRED' } };
    }
    const lines = await d1All(database, `SELECT employee_id,beneficiary_name,bank_name,bank_code,
      account_ciphertext,account_iv,line_hash,amount FROM payment_instruction_lines
      WHERE payment_instruction_id=? ORDER BY employee_id,id`, [payment.id]);
    if (lines.length !== Number(payment.recipient_count) || lines.some((line) => !line.account_ciphertext || !line.account_iv || !line.line_hash)) {
      return { status:409, data:{ error:'Snapshot PI tidak lengkap; approval diblokir dan PI harus diregenerasi', code:'PI_SNAPSHOT_INCOMPLETE' } };
    }
    let decrypted;
    try {
      decrypted = await Promise.all(lines.map(async (line) => ({
        ...line,
        accountNumber: await decryptAccountNumber(line.account_ciphertext,line.account_iv,env.PI_ENCRYPTION_KEY),
      })));
    } catch {
      return { status:409, data:{ error:'Snapshot rekening PI gagal diverifikasi; approval diblokir', code:'PI_SNAPSHOT_DECRYPT_FAILED' } };
    }
    for (const line of decrypted) {
      const expectedLineHash = await sha256Hex(JSON.stringify({
        employeeId: line.employee_id,
        beneficiaryName: line.beneficiary_name,
        bankCode: line.bank_code,
        accountNumber: String(line.accountNumber),
        amount: Number(line.amount),
      }));
      if (expectedLineHash !== line.line_hash) {
        return { status:409, data:{ error:'Integritas salah satu baris PI berubah; approval diblokir', code:'PI_LINE_HASH_MISMATCH' } };
      }
    }
    const serverHash = await instructionContentHash({
      organizationId,
      clientId:payment.client_id,
      submissionId:payment.submission_id,
      payrollPeriod:payment.payroll_period,
      paymentPeriod:payment.payment_period,
    }, decrypted.map((line) => ({
      employeeId:line.employee_id,
      beneficiaryName:line.beneficiary_name,
      bankName:line.bank_name,
      bankCode:line.bank_code,
      accountNumber:line.accountNumber,
      amount:Number(line.amount),
    })));
    if (serverHash !== payment.content_hash || serverHash !== body.actionHash) {
      return { status:409, data:{ error:'Content hash hasil verifikasi server tidak sesuai snapshot PI; approval diblokir', code:'PI_SERVER_HASH_MISMATCH' } };
    }
    const existing = await d1First(database, 'SELECT * FROM payment_approvals WHERE payment_instruction_id=? AND action_hash=? LIMIT 1', [payment.id, body.actionHash]);
    if (existing) return { data: { ok: true, approval: existing, idempotentReplay: true } };
    const approvalId = `PA-${crypto.randomUUID()}`;
    await d1Batch(database, [
      { statement: `INSERT INTO payment_approvals (id,payment_instruction_id,approver_user_id,status,action_hash)
        VALUES (?,?,?,'APPROVED',?)`, bindings: [approvalId, payment.id, actor.id, body.actionHash] },
      { statement: `UPDATE payment_instructions SET status='APPROVED_FOR_PAYMENT',updated_at=${NOW} WHERE id=? AND status='PAYMENT_APPROVAL_PENDING'`, bindings: [payment.id] },
      { statement: `UPDATE payroll_submissions SET state='APPROVED_FOR_PAYMENT',updated_at=${NOW} WHERE id=? AND state='PAYMENT_APPROVAL_PENDING'`, bindings: [payment.submission_id] },
      auditOperation(organizationId, actor, 'PAYMENT_APPROVED', `Maker-checker approval passed · ${payment.recipient_count} recipients · ${serverHash}`, 'payment_instruction', payment.id),
    ]);
    return { data: { ok: true, approval: { id: approvalId, paymentInstructionId: payment.id, status: 'APPROVED' } } };
  }

  if (body.action === 'REJECT_PAYMENT') {
    if (!CONTROLLER_ROLES.has(actor.role) || !actor.permissions?.includes('payment:approve')) {
      return { status:403, data:{ error:'Hanya Payroll Controller dengan izin payment:approve yang dapat reject PI', code:'PAYMENT_APPROVE_PERMISSION_REQUIRED' } };
    }
    const payment = await d1First(database, `SELECT * FROM payment_instructions WHERE id=? AND org_id=? LIMIT 1`, [body.paymentInstructionId, organizationId]);
    if (!payment) return { status:404, data:{ error:'Payment instruction tidak ditemukan' } };
    if (payment.status !== 'PAYMENT_APPROVAL_PENDING') return { status:409, data:{ error:'PI tidak sedang menunggu approval' } };
    await d1Batch(database, [
      { statement:`UPDATE payment_instructions SET status='REVISION_REQUIRED',updated_at=${NOW} WHERE id=?`, bindings:[payment.id] },
      { statement:`UPDATE payroll_submissions SET state='REVISION_REQUIRED',updated_at=${NOW} WHERE id=?`, bindings:[payment.submission_id] },
      auditOperation(organizationId, actor, 'PAYMENT_INSTRUCTION_REJECTED', String(body.reason).trim(), 'payment_instruction', payment.id),
    ]);
    return { data:{ ok:true,status:'REVISION_REQUIRED' } };
  }

  if (body.action === 'UPLOAD_PAYMENT_PROOF') return { status: 409, data: { error: 'Use /api/payment-proof multipart upload so evidence is stored in R2' } };

  if (body.action === 'RECONCILE_PAYMENT') {
    if (!PROCESSOR_ROLES.has(actor.role) && !CONTROLLER_ROLES.has(actor.role)) return { status: 403, data: { error: 'Role tidak dapat melakukan rekonsiliasi' } };
    const payment = await d1First(database, `SELECT pi.id,pi.submission_id,pi.status,pi.expected_total,
      COALESCE((SELECT SUM(amount) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id),0) AS instruction_total,
      COALESCE((SELECT SUM(amount) FROM payment_proofs WHERE payment_instruction_id=pi.id),0) AS manual_proof_total,
      COALESCE((SELECT amount FROM payment_gateway_transactions
        WHERE payment_instruction_id=pi.id AND status='SUCCEEDED'
        ORDER BY COALESCE(paid_at,updated_at,created_at) DESC LIMIT 1),0) AS gateway_total
      FROM payment_instructions pi WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [body.paymentInstructionId, organizationId]);
    if (!payment) return { status: 404, data: { error: 'Payment instruction not found' } };
    const paymentState = String(payment.status || '').toUpperCase();
    if (!['PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED'].includes(paymentState)) {
      return { status:409, data:{
        error:'Payment instruction belum berada pada tahap rekonsiliasi',
        code:'RECONCILIATION_STATE_REQUIRED',
        paymentStatus:paymentState,
      } };
    }
    const settlementTotal = Number(payment.manual_proof_total || 0) > 0
      ? Number(payment.manual_proof_total)
      : Number(payment.gateway_total || 0);
    const settlementSource = Number(payment.manual_proof_total || 0) > 0 ? 'MANUAL_PROOF' : 'PAYMENT_GATEWAY';
    const difference = settlementTotal - Number(payment.expected_total);
    const status = difference === 0 && Number(payment.instruction_total) === Number(payment.expected_total) ? 'MATCHED' : 'EXCEPTION';
    const id = `REC-${crypto.randomUUID()}`;
    await d1Batch(database, [
      { statement: `INSERT INTO reconciliations
        (id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status,reviewed_by)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(payment_instruction_id) DO UPDATE SET
        expected_total=excluded.expected_total,instruction_total=excluded.instruction_total,proof_total=excluded.proof_total,
        difference=excluded.difference,status=excluded.status,reviewed_by=excluded.reviewed_by,created_at=${NOW}`,
        bindings: [id, payment.id, payment.expected_total, payment.instruction_total, settlementTotal, difference, status, actor.email] },
      { statement: `UPDATE payment_instructions SET status=?,updated_at=${NOW} WHERE id=?`,
        bindings: [status === 'MATCHED' ? 'COMPLETED' : 'PAYMENT_EXCEPTION', payment.id] },
      { statement: `UPDATE payroll_submissions SET state=?,updated_at=${NOW} WHERE id=?`,
        bindings: [status === 'MATCHED' ? 'COMPLETED' : 'PAYMENT_EXCEPTION', payment.submission_id] },
      auditOperation(organizationId, actor, 'PAYMENT_RECONCILED', `${status} · ${settlementSource} · settled ${settlementTotal} · difference ${difference}`, 'payment_instruction', payment.id),
    ]);
    if (status === 'MATCHED') {
      try { await markEwaRepaid(database, payment.submission_id); }
      catch (error) {
        if (!/no such table|no such column/i.test(String(error?.message || error))) throw error;
      }
    }
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
    if (actor.role === 'CLIENT_USER' && !['ADD_EXCEPTION_NOTE','RESOLVE_EXCEPTION','CLIENT_APPROVE_PAYROLL','CLIENT_REQUEST_PAYROLL_REVISION'].includes(body.action)) {
      return respond({ error:'Client User memiliki akses monitoring, koreksi exception, dan approval payroll sesuai scope' }, 403);
    }
    const result = await executeAction(env.DB, body, actor, env, organizationId);
    return respond(result.data, result.status || 200);
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
