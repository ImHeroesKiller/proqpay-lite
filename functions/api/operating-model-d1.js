import { d1All, d1Batch, d1First } from './_d1.js';
import { applyEwaRepayments, markEwaRepaid } from './_ewa.js';
import { handlePreflight, publicError, secureJson } from './_security.js';
import { canTransition, resolveTierTransition, validateOperatingAction } from './operating-model-validation.js';
import { canonicalBankCode, encryptAccountNumber, instructionContentHash, sha256Hex } from './payment-instruction-core.js';

const METHODS = 'GET, POST, OPTIONS';
const PROCESSOR_ROLES = new Set(['SUPER_ADMIN', 'PAYROLL_PROCESSOR']);
const CONTROLLER_ROLES = new Set(['SUPER_ADMIN', 'PAYROLL_CONTROLLER']);
const CLIENT_ROLES = new Set(['CLIENT_USER']);
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
  (SELECT COUNT(*) FROM payroll_exceptions pe WHERE pe.submission_id=s.id AND pe.severity='CRITICAL'
    AND pe.status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')) AS blocking_count
  FROM payroll_submissions s JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id`;

const PI_SELECT = `SELECT pi.*, s.period AS payroll_period, COALESCE(s.payment_period,s.period) AS payment_period,
  COALESCE(s.arrears_periods,'[]') AS arrears_periods, c.name AS client_name, p.name AS project_name,
  (SELECT COUNT(*) FROM payment_instructions pir WHERE pir.submission_id=pi.submission_id
    AND (pir.created_at<pi.created_at OR (pir.created_at=pi.created_at AND pir.id<=pi.id))) AS revision_no,
  (SELECT COUNT(*) FROM payment_instructions pit WHERE pit.submission_id=pi.submission_id) AS revision_count,
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
      CASE WHEN previous.employee_id IS NULL THEN 'NEW' WHEN current.net_amount<>previous.net_amount THEN 'CHANGED' ELSE 'UNCHANGED' END AS variance_type
      FROM payroll_run_lines current LEFT JOIN payroll_run_lines previous
        ON previous.submission_id=? AND previous.employee_id=current.employee_id
      WHERE current.submission_id=? ORDER BY current.employee_name`, [previous?.id || '', submission.id]);
    parseJsonFields(lines, ['components']);
    const removed = previous ? await d1All(database, `SELECT p.employee_id,p.employee_name,p.net_amount AS previous_net
      FROM payroll_run_lines p LEFT JOIN payroll_run_lines c ON c.submission_id=? AND c.employee_id=p.employee_id
      WHERE p.submission_id=? AND p.included=1 AND c.employee_id IS NULL ORDER BY p.employee_name`, [submission.id, previous.id]) : [];
    const currentTotal = lines.filter((line)=>line.included).reduce((sum,line)=>sum+Number(line.net_amount||0),0);
    const previousTotal = lines.filter((line)=>line.included).reduce((sum,line)=>sum+Number(line.previous_net||0),0)
      + removed.reduce((sum,line)=>sum+Number(line.previous_net||0),0);
    return { data:{ ok:true, submission, previousPeriod:previous?.period || null, lines, removed,
      variance:{ currentTotal, previousTotal, amount:currentTotal-previousTotal,
        percent:previousTotal ? Number((((currentTotal-previousTotal)/previousTotal)*100).toFixed(2)) : null,
        newEmployees:lines.filter((line)=>line.variance_type==='NEW'&&line.included).length,
        changedEmployees:lines.filter((line)=>line.variance_type==='CHANGED'&&line.included).length,
        removedEmployees:removed.length } } };
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
      COALESCE(c.billing_email,c.contact_email,(SELECT au.email FROM app_users au JOIN user_client_scopes ucs ON ucs.user_id=au.id WHERE ucs.client_id=pi.client_id AND au.role='CLIENT_USER' AND au.status='ACTIVE' ORDER BY au.created_at LIMIT 1)) AS client_email,
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
  const clientScope = scopeWhere({ organizationId, clientId, projectIds: [], orgColumn: 'c.org_id', clientColumn: 'c.id' });
  const projectScope = scopeWhere({ organizationId, clientId, projectIds, orgColumn: 'p.org_id', clientColumn: 'p.client_id', projectColumn: 'p.id' });
  const employeeScope = scopeWhere({ organizationId, clientId, projectIds, orgColumn: 'e.org_id', clientColumn: 'e.client_id', projectColumn: 'e.project_id' });
  const [exceptions, paymentInstructions, paymentProofs, reconciliations, clientCount, projectCount, employeeCount, bankCount] = await Promise.all([
    readResource(database, new URLSearchParams({ resource: 'exceptions', ...(clientId ? { clientId } : {}) }), actor, env, organizationId),
    readResource(database, new URLSearchParams({ resource: 'payment-instructions', ...(clientId ? { clientId } : {}) }), actor, env, organizationId),
    readResource(database, new URLSearchParams({ resource: 'payment-proofs', ...(clientId ? { clientId } : {}) }), actor, env, organizationId),
    readResource(database, new URLSearchParams({ resource: 'reconciliations', ...(clientId ? { clientId } : {}) }), actor, env, organizationId),
    d1First(database, `SELECT COUNT(*) AS total FROM clients c WHERE ${clientScope.sql}`, clientScope.bindings),
    d1First(database, `SELECT COUNT(*) AS total FROM projects p WHERE ${projectScope.sql}`, projectScope.bindings),
    d1First(database, `SELECT COUNT(*) AS total,
      SUM(CASE WHEN UPPER(COALESCE(e.status_aktif,'ACTIVE'))='ACTIVE' THEN 1 ELSE 0 END) AS active
      FROM employees e WHERE ${employeeScope.sql}`, employeeScope.bindings),
    d1First(database, `SELECT COUNT(DISTINCT e.id) AS total FROM employees e
      JOIN employee_bank_accounts eba ON eba.employee_id=e.id AND eba.is_primary=1
      WHERE ${employeeScope.sql}`, employeeScope.bindings),
  ]);
  const employees = Number(employeeCount?.total || 0);
  const primaryAccounts = Number(bankCount?.total || 0);
  return { data: { ok: true, submissions, exceptions: exceptions.data.exceptions,
    paymentInstructions: paymentInstructions.data.paymentInstructions,
    paymentProofs: paymentProofs.data.paymentProofs, reconciliations: reconciliations.data.reconciliations,
    portfolioSummary: { clients: Number(clientCount?.total || 0), projects: Number(projectCount?.total || 0),
      employees, activeEmployees: Number(employeeCount?.active || 0), primaryAccounts,
      bankCoveragePercent: employees ? Math.round((primaryAccounts / employees) * 100) : 0 } } };
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
    if (!PROCESSOR_ROLES.has(actor.role) && !CLIENT_ROLES.has(actor.role)) return { status:403, data:{ error:'Insufficient role' } };
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
    let sourceSubmission = null;
    if (body.sourceMode === 'COPY_PREVIOUS') {
      sourceSubmission = await d1First(database, `SELECT id,period FROM payroll_submissions WHERE org_id=? AND client_id=?
        AND project_id=? AND run_type='REGULAR' AND period<? AND state<>'CANCELLED' ORDER BY period DESC,created_at DESC LIMIT 1`,
        [organizationId, body.clientId, body.projectId, body.period]);
      if (!sourceSubmission) return { status:409, data:{ error:'Belum ada Pay Run periode sebelumnya untuk disalin' } };
      const sourceLines = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_run_lines WHERE submission_id=?`, [sourceSubmission.id]);
      if (!Number(sourceLines?.count||0)) return { status:409, data:{ error:'Pay Run sebelumnya belum memiliki snapshot canonical; gunakan Upload data final untuk periode pertama' } };
    }
    if (body.parentSubmissionId) {
      const parent = await d1First(database, `SELECT id FROM payroll_submissions WHERE id=? AND org_id=? AND client_id=? AND project_id=? LIMIT 1`,
        [body.parentSubmissionId, organizationId, body.clientId, body.projectId]);
      if (!parent) return { status:409, data:{ error:'Pay Run induk tidak valid' } };
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
    const row = await d1First(database, `${SUBMISSION_SELECT} WHERE s.id=? LIMIT 1`, [id]);
    return { status:201, data:{ ok:true, submission:row, sourcePeriod:sourceSubmission?.period || null } };
  }

  if (body.action === 'REFRESH_PAY_RUN_FROM_MASTER') {
    if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Insufficient role' } };
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId,organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    if (submission.source_mode!=='MASTER_CURRENT') return { status:409, data:{ error:'Hitung ulang master hanya tersedia untuk sumber MASTER_CURRENT' } };
    if (submission.period_status==='CLOSED' || !['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','REVISION_REQUIRED'].includes(submission.state)) {
      return { status:409, data:{ error:'Snapshot Pay Run sudah terkunci dan tidak dapat dihitung ulang' } };
    }
    await d1Batch(database, [
      { statement:`UPDATE payroll_run_lines SET
          gross_amount=CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END,
          deduction_amount=CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.imported_deduction,0) ELSE 0 END,
          net_amount=MAX(0,(CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN ec.imported_gross ELSE COALESCE(ec.basic_salary,0) END)
            -(CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.imported_deduction,0) ELSE 0 END)),
          components=CASE WHEN ec.payroll_source_period=? AND ec.imported_gross>0 THEN COALESCE(ec.payroll_components,'{}')
            ELSE json_object('Gaji Pokok',COALESCE(ec.basic_salary,0)) END,
          source='MASTER_CURRENT',updated_at=${NOW}
        FROM employee_compensation ec WHERE payroll_run_lines.submission_id=? AND ec.employee_id=payroll_run_lines.employee_id`,
        bindings:[submission.period,submission.period,submission.period,submission.period,submission.period,submission.id] },
      { statement:`UPDATE payroll_submissions SET input_status='PENDING',updated_at=${NOW} WHERE id=?`, bindings:[submission.id] },
      auditOperation(organizationId,actor,'PAY_RUN_MASTER_REFRESHED',`Master compensation refreshed for ${submission.period}`,'payroll_submission',submission.id),
    ]);
    const quality = await d1First(database, `SELECT COUNT(*) AS recipients,
      SUM(CASE WHEN gross_amount>0 THEN 1 ELSE 0 END) AS calculated,
      SUM(CASE WHEN gross_amount<=0 THEN 1 ELSE 0 END) AS missing_salary,
      SUM(gross_amount) AS total_gross,SUM(deduction_amount) AS total_deduction,SUM(net_amount) AS total_net
      FROM payroll_run_lines WHERE submission_id=? AND included=1`, [submission.id]);
    return { data:{ ok:true,summary:{recipients:Number(quality?.recipients||0),calculated:Number(quality?.calculated||0),
      missingSalary:Number(quality?.missing_salary||0),totalGross:Number(quality?.total_gross||0),
      totalDeduction:Number(quality?.total_deduction||0),totalNet:Number(quality?.total_net||0)} } };
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
    if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Insufficient role' } };
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId, organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    if (submission.period_status==='CLOSED' || !['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','REVISION_REQUIRED'].includes(submission.state)) return { status:409, data:{ error:'Snapshot Pay Run sudah terkunci' } };
    const row = await d1First(database, `UPDATE payroll_run_lines SET gross_amount=?,deduction_amount=?,net_amount=?,included=?,components=?,updated_at=${NOW}
      WHERE submission_id=? AND employee_id=? RETURNING *`, [body.grossAmount,body.deductionAmount,body.netAmount,
      body.included===false?0:1,JSON.stringify(body.components||{}),body.submissionId,body.employeeId]);
    if (!row) return { status:404, data:{ error:'Karyawan tidak ditemukan pada snapshot Pay Run' } };
    await d1First(database, `UPDATE payroll_submissions SET input_status='PENDING',updated_at=${NOW} WHERE id=? RETURNING id`, [body.submissionId]);
    return { data:{ ok:true,line:row } };
  }

  if (body.action === 'FINALIZE_PAY_RUN_INPUT') {
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId, organizationId]);
    if (!submission || submission.period_status==='CLOSED') return { status:409, data:{ error:'Pay Run tidak tersedia untuk finalisasi input' } };
    if (!PROCESSOR_ROLES.has(actor.role) && !CLIENT_ROLES.has(actor.role)) return { status:403, data:{ error:'Insufficient role' } };
    if (!assertClientScope(actor, env, submission.client_id) || !assertProjectScope(actor, submission.project_id)) return { status:403, data:{ error:'Scope denied' } };
    try { await applyEwaRepayments(database, submission.id); }
    catch (error) {
      if (!/no such table|no such column/i.test(String(error?.message || error))) throw error;
    }
    const quality = await d1First(database, `SELECT COUNT(*) AS recipients,
      SUM(CASE WHEN net_amount<=0 THEN 1 ELSE 0 END) AS invalid_net,
      SUM(CASE WHEN bank_name IS NULL OR account_last4 IS NULL THEN 1 ELSE 0 END) AS invalid_bank
      FROM payroll_run_lines WHERE submission_id=? AND included=1`, [submission.id]);
    if (!Number(quality?.recipients||0)) return { status:409, data:{ error:'Pay Run tidak memiliki penerima aktif' } };
    if (Number(quality?.invalid_net||0) || Number(quality?.invalid_bank||0)) return { status:409, data:{ error:`Input belum valid: ${Number(quality?.invalid_net||0)} THP dan ${Number(quality?.invalid_bank||0)} rekening bermasalah` } };
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
    const blockingCount = Number(blocking?.count || 0);
    let targetState;
    let reviewFields = '';
    const bindings = [];

    if (body.command === 'VALIDATE') {
      if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat menjalankan validasi' } };
      if (!['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','CLIENT_RESUBMITTED','REVISION_REQUIRED','EXCEPTION_FOUND'].includes(submission.state)) {
        return { status:409, data:{ error:`Pay Run berstatus ${submission.state} tidak dapat divalidasi ulang` } };
      }
      if (submission.input_status !== 'READY') return { status:409, data:{ error:'Finalisasi input payroll sebelum menjalankan validasi' } };
      targetState = blockingCount ? 'EXCEPTION_FOUND' : 'VALIDATED';
    } else if (body.command === 'FINALIZE_PAYROLL') {
      if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat memfinalisasi payroll' } };
      if (!['VALIDATED','STANDARDIZED'].includes(submission.state)) return { status:409, data:{ error:'Pay Run harus selesai divalidasi sebelum difinalisasi' } };
      if (blockingCount) return { status:409, data:{ error:`${blockingCount} critical exception masih terbuka` } };
      targetState = 'PAYMENT_INSTRUCTION_READY';
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
    if (!CONTROLLER_ROLES.has(actor.role)) return { status:403, data:{ error:'Insufficient role' } };
    const submission = await d1First(database, `SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1`, [body.submissionId, organizationId]);
    if (!submission) return { status:404, data:{ error:'Pay Run tidak ditemukan' } };
    if (submission.input_status!=='READY' || !['PAYROLL_FINALIZED','COMPLETED'].includes(submission.state)) return { status:409, data:{ error:'Pay Run hanya dapat ditutup setelah input final dan payroll finalized' } };
    const row = await d1First(database, `UPDATE payroll_submissions SET period_status='CLOSED',closed_at=${NOW},closed_by=?,updated_at=${NOW} WHERE id=? RETURNING *`, [actor.email,submission.id]);
    return { data:{ ok:true,submission:row } };
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
    await d1Batch(database, [
      { statement: update, bindings },
      auditOperation(organizationId, actor, 'SUBMISSION_TRANSITION', `${submission.state} → ${targetState}`, 'payroll_submission', submission.id),
    ]);
    const updatedSubmission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=?', [submission.id]);
    return { data: { ok: true, submission: updatedSubmission } };
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

  if (body.action === 'GENERATE_PAYMENT_INSTRUCTION' || body.action === 'APPROVE_PAYROLL_AND_GENERATE_PI') {
    const atomicControllerApproval = body.action === 'APPROVE_PAYROLL_AND_GENERATE_PI';
    if (atomicControllerApproval ? !CONTROLLER_ROLES.has(actor.role) : !PROCESSOR_ROLES.has(actor.role)) {
      return { status: 403, data: { error: atomicControllerApproval
        ? 'Hanya Payroll Controller yang dapat menyetujui payroll dan menerbitkan PI'
        : 'Hanya Payroll Processor yang dapat membuat PI' } };
    }
    const submission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    if (!submission) return { status: 404, data: { error: 'Submission not found' } };
    const existing = await d1First(database, `SELECT * FROM payment_instructions
      WHERE submission_id=? AND org_id=? AND status<>'REJECTED' ORDER BY created_at DESC LIMIT 1`, [submission.id, organizationId]);
    if (atomicControllerApproval && submission.state === 'PAYMENT_INSTRUCTION_READY' && existing && existing.status !== 'REVISION_REQUIRED') {
      return { data: { ok: true, paymentInstruction: existing, idempotentReplay: true } };
    }
    const expectedState = atomicControllerApproval ? 'CONTROLLER_REVIEW' : 'PAYMENT_INSTRUCTION_READY';
    if (submission.state !== expectedState) return { status: 409, data: { error: atomicControllerApproval
      ? 'Submission tidak berada pada tahap review Controller'
      : 'Submission belum siap dibuatkan payment instruction' } };
    if (atomicControllerApproval && body.reviewConfirmed !== true) return { status:409, data:{ error:'Preview dan konfirmasi review wajib dilakukan sebelum melanjutkan' } };
    if (atomicControllerApproval) {
      const blocking = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_exceptions WHERE submission_id=?
        AND severity='CRITICAL' AND status NOT IN ('ACCEPTED','RESOLVED','AUTO_NORMALIZED')`, [submission.id]);
      if (Number(blocking?.count || 0) > 0) return { status:409, data:{ error:'Critical exceptions still open' } };
    }
    if (existing && existing.status !== 'REVISION_REQUIRED') return { data: { ok: true, paymentInstruction: existing, idempotentReplay: true } };
    const snapshotCount = await d1First(database, `SELECT COUNT(*) AS count FROM payroll_run_lines WHERE submission_id=?`, [submission.id]);
    const source = Number(snapshotCount?.count || 0) ? await d1All(database, `SELECT l.employee_id AS id,l.employee_name AS name,l.net_amount AS amount,
      eba.bank_name,eba.account_no,l.account_last4 FROM payroll_run_lines l
      LEFT JOIN employee_bank_accounts eba ON eba.employee_id=l.employee_id AND eba.is_primary=1
      WHERE l.submission_id=? AND l.included=1 ORDER BY l.employee_name`, [submission.id])
      : await d1All(database, `SELECT e.id,e.name,COALESCE(ec.imported_net,0) AS amount,
        (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS bank_name,
        (SELECT account_no FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS account_no,
        (SELECT substr(account_no,-4) FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS account_last4
        FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id WHERE e.client_id=?
        AND (? IS NULL OR e.project_id=?) AND ec.payroll_source_period=? ORDER BY e.name`,
        [submission.client_id, submission.project_id || null, submission.project_id || null, submission.period]);
    if (!source.length) return { status: 409, data: { error: 'Tidak ada data payroll final untuk periode submission' } };
    const invalid = source.filter((row) => Number(row.amount || 0) <= 0 || !row.bank_name || !row.account_no);
    if (invalid.length) return { status: 409, data: { error: `${invalid.length} karyawan belum memiliki THP atau rekening bank yang valid` } };
    const changedAccounts = source.filter((row) => row.account_last4 && String(row.account_no).slice(-4) !== String(row.account_last4));
    if (changedAccounts.length) return { status:409, data:{ error:`${changedAccounts.length} rekening berubah setelah snapshot; review dan finalisasi ulang Pay Run diperlukan` } };
    if (!env.PI_ENCRYPTION_KEY || String(env.PI_ENCRYPTION_KEY).length < 32) return { status: 503, data: { error: 'PI_ENCRYPTION_KEY belum dikonfigurasi dengan aman' } };
    const expectedTotal = source.reduce((sum, row) => sum + Number(row.amount), 0);
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
    // A rejected PI is immutable history. Even with an unchanged content hash,
    // resubmission creates a distinct revision instead of resurrecting the old row.
    const revision = await d1First(database, 'SELECT COUNT(*) AS count FROM payment_instructions WHERE submission_id=? AND org_id=?', [submission.id, organizationId]);
    const revisionNo = Number(revision?.count || 0) + 1;
    const idempotencyKey = `${`PI-${submission.id}-${paymentPeriod}`.slice(0, 105)}${revisionNo > 1 ? `-R${revisionNo}` : ''}`;
    const documentNo = `PI/${paymentPeriod.replace('-','')}/${contentHash.slice(0,10).toUpperCase()}${revisionNo > 1 ? `/R${revisionNo - 1}` : ''}`;
    await d1Batch(database, [
      ...(existing ? [{ statement:`UPDATE payment_instructions SET status='REJECTED',updated_at=${NOW} WHERE id=? AND status='REVISION_REQUIRED'`, bindings:[existing.id] }] : []),
      { statement: `INSERT INTO payment_instructions
        (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,
         document_no,content_hash,currency,execution_date,recipient_count)
        VALUES (?,?,?,?,'PAYMENT_INSTRUCTION_READY',?,?,?,?,?,'IDR',?,?)`,
        bindings: [id, organizationId, submission.client_id, submission.id, expectedTotal, actor.id, idempotencyKey,
          documentNo, contentHash, `${paymentPeriod}-01`, snapshotLines.length] },
      ...lineInsertOperations(id, snapshotLines),
      { statement: atomicControllerApproval
        ? `UPDATE payroll_submissions SET state='PAYMENT_INSTRUCTION_READY',controller_reviewed_at=${NOW},controller_reviewed_by=?,controller_review_note=?,updated_at=${NOW} WHERE id=? AND state='CONTROLLER_REVIEW'`
        : `UPDATE payroll_submissions SET state='PAYMENT_INSTRUCTION_READY',updated_at=${NOW} WHERE id=?`,
        bindings: atomicControllerApproval ? [actor.email, String(body.reviewNote || '').slice(0,1000), submission.id] : [submission.id] },
      ...(atomicControllerApproval ? [auditOperation(organizationId, actor, 'PAYROLL_APPROVED_AND_PI_CREATED',
        `CONTROLLER_REVIEW → PAYMENT_INSTRUCTION_READY · ${documentNo}`, 'payroll_submission', submission.id)] : []),
      auditOperation(organizationId, actor, existing ? 'PAYMENT_INSTRUCTION_REVISED' : 'PAYMENT_INSTRUCTION_CREATED', `${documentNo} · revisi ${revisionNo} · ${snapshotLines.length} penerima · ${contentHash}`, 'payment_instruction', id),
    ]);
    const paymentInstruction = await d1First(database, 'SELECT * FROM payment_instructions WHERE id=?', [id]);
    return { status: 201, data: { ok: true, paymentInstruction } };
  }

  if (body.action === 'SUBMIT_PAYMENT_INSTRUCTION') {
    if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat submit PI' } };
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

  if (body.action === 'OPEN_PAYMENT_REVIEW') {
    if (!CONTROLLER_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Controller yang dapat membuka review PI' } };
    const payment = await d1First(database, `SELECT * FROM payment_instructions WHERE id=? AND org_id=? LIMIT 1`, [body.paymentInstructionId, organizationId]);
    if (!payment) return { status:404, data:{ error:'Payment instruction tidak ditemukan' } };
    if (payment.status !== 'PAYMENT_INSTRUCTION_READY') return { status:409, data:{ error:'PI tidak berada pada status siap review' } };
    if (String(payment.creator_user_id) === String(actor.id)) return { status:409, data:{ error:'Maker PI tidak boleh membuka review atas PI buatannya sendiri' } };
    await d1Batch(database, [
      { statement:`UPDATE payment_instructions SET status='PAYMENT_APPROVAL_PENDING',updated_at=${NOW} WHERE id=? AND status='PAYMENT_INSTRUCTION_READY'`, bindings:[payment.id] },
      { statement:`UPDATE payroll_submissions SET state='PAYMENT_APPROVAL_PENDING',updated_at=${NOW} WHERE id=?`, bindings:[payment.submission_id] },
      auditOperation(organizationId, actor, 'PAYMENT_REVIEW_OPENED', 'Controller membuka PI revisi untuk review maker-checker', 'payment_instruction', payment.id),
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
    if (!CONTROLLER_ROLES.has(actor.role)) return { status: 403, data: { error: 'Hanya Payroll Controller yang dapat approve PI' } };
    const payment = await d1First(database, `SELECT pi.*,
      COALESCE((SELECT SUM(amount) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id),0) AS instruction_total
      FROM payment_instructions pi WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [body.paymentInstructionId, organizationId]);
    if (!payment) return { status: 404, data: { error: 'Payment instruction not found' } };
    if (payment.status !== 'PAYMENT_APPROVAL_PENDING') return { status:409, data:{ error:'PI belum disubmit atau tidak lagi menunggu approval' } };
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

  if (body.action === 'REJECT_PAYMENT') {
    if (!CONTROLLER_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Controller yang dapat reject PI' } };
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

  if (body.action === 'APPLY_BANK_CORRECTIONS') {
    if (!PROCESSOR_ROLES.has(actor.role)) return { status:403, data:{ error:'Hanya Payroll Processor yang dapat memperbaiki rekening PI' } };
    const submission = await d1First(database, 'SELECT * FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1', [body.submissionId, organizationId]);
    const payment = await d1First(database, 'SELECT * FROM payment_instructions WHERE id=? AND submission_id=? AND org_id=? LIMIT 1', [body.paymentInstructionId, body.submissionId, organizationId]);
    if (!submission || !payment) return { status:404, data:{ error:'Submission atau Payment Instruction tidak ditemukan' } };
    if (!assertClientScope(actor, env, submission.client_id) || !assertProjectScope(actor, submission.project_id)) return { status:403, data:{ error:'Scope denied' } };
    if (submission.state !== 'REVISION_REQUIRED' || payment.status !== 'REVISION_REQUIRED') {
      return { status:409, data:{ error:'Koreksi rekening hanya tersedia untuk PI yang dikembalikan Controller' } };
    }
    const corrections = body.corrections.map((row) => ({ employeeId:String(row.employeeId), bankName:String(row.bankName).trim(), accountNo:String(row.accountNo).replace(/[\s.-]/g, '') }));
    const placeholders = corrections.map(() => '?').join(',');
    const eligible = await d1All(database, `SELECT employee_id FROM payroll_run_lines WHERE submission_id=? AND included=1 AND employee_id IN (${placeholders})`, [submission.id, ...corrections.map((row) => row.employeeId)]);
    const eligibleIds = new Set(eligible.map((row) => String(row.employee_id)));
    const unknown = corrections.filter((row) => !eligibleIds.has(row.employeeId));
    if (unknown.length) return { status:409, data:{ error:`${unknown.length} karyawan tidak termasuk snapshot Pay Run aktif` } };
    const operations = [];
    for (const row of corrections) {
      const bankId = `BNK-${row.employeeId}`;
      operations.push(
        { statement:'UPDATE employee_bank_accounts SET is_primary=0 WHERE employee_id=? AND id<>?', bindings:[row.employeeId, bankId] },
        { statement:`INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) VALUES(?,?,?,?,1)
          ON CONFLICT(id) DO UPDATE SET bank_name=excluded.bank_name,account_no=excluded.account_no,is_primary=1`, bindings:[bankId,row.employeeId,row.bankName,row.accountNo] },
        { statement:`UPDATE payroll_run_lines SET bank_name=?,account_last4=?,updated_at=${NOW} WHERE submission_id=? AND employee_id=?`, bindings:[row.bankName,row.accountNo.slice(-4),submission.id,row.employeeId] },
      );
    }
    const auditDetail = JSON.stringify({ count:corrections.length, employees:corrections.map((row) => ({ employeeId:row.employeeId, accountLast4:row.accountNo.slice(-4) })) });
    operations.push(
      { statement:`UPDATE payroll_submissions SET state='PAYMENT_INSTRUCTION_READY',updated_at=${NOW} WHERE id=?`, bindings:[submission.id] },
      auditOperation(organizationId, actor, 'PI_BANK_CORRECTIONS_APPLIED', auditDetail, 'payment_instruction', payment.id),
    );
    await d1Batch(database, operations);
    return { data:{ ok:true, corrected:corrections.length, submissionState:'PAYMENT_INSTRUCTION_READY' } };
  }

  if (body.action === 'UPLOAD_PAYMENT_PROOF') return { status: 409, data: { error: 'Use /api/payment-proof multipart upload so evidence is stored in R2' } };

  if (body.action === 'RECONCILE_PAYMENT') {
    if (!PROCESSOR_ROLES.has(actor.role) && !CONTROLLER_ROLES.has(actor.role)) return { status: 403, data: { error: 'Role tidak dapat melakukan rekonsiliasi' } };
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
    if (actor.role === 'CLIENT_USER') return respond({ error:'Client User memiliki akses monitoring saja' }, 403);
    const result = await executeAction(env.DB, body, actor, env, organizationId);
    return respond(result.data, result.status || 200);
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
