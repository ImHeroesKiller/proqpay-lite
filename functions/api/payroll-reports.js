import { d1All, hasD1 } from './_d1.js';
import { clientIdsFor, projectIdsFor, authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';

const METHODS = 'GET, OPTIONS';
const ROLES = ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER'];

function scopeSql(actor, env, alias = 's') {
  const clauses = [`${alias}.org_id=?`];
  const bindings = [String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO')];
  if (actor.role === 'CLIENT_USER') {
    const clients = clientIdsFor(actor, env) || [];
    const projects = projectIdsFor(actor) || [];
    if (!clients.length) return { denied: true, sql: '1=0', bindings: [] };
    clauses.push(`${alias}.client_id IN (${clients.map(() => '?').join(',')})`);
    bindings.push(...clients);
    if (projects.length) {
      clauses.push(`${alias}.project_id IN (${projects.map(() => '?').join(',')})`);
      bindings.push(...projects);
    }
  }
  return { denied: false, sql: clauses.join(' AND '), bindings };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return secureJson({ error: 'GET only' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ROLES, mutating: false, methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'payroll-reports', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);

  const params = new URL(request.url).searchParams;
  const type = String(params.get('type') || 'register').toLowerCase();
  const period = params.get('period');
  const clientId = params.get('clientId');
  const base = scopeSql(authorization.actor, env, 's');
  if (base.denied) return respond({ ok: true, type, rows: [] });
  const clauses = [base.sql];
  const bindings = [...base.bindings];
  if (period && /^\d{4}-\d{2}$/.test(period)) { clauses.push('s.period=?'); bindings.push(period); }
  if (clientId) { clauses.push('s.client_id=?'); bindings.push(clientId); }
  const where = clauses.join(' AND ');

  if (type === 'register') {
    const rows = await d1All(env.DB, `SELECT s.id AS submission_id,s.period,s.payment_period,s.run_type,s.source_mode,s.state,
      c.name AS client_name,p.name AS project_name,l.employee_id,l.employee_code,l.employee_name,l.employment_status,
      l.gross_amount,l.deduction_amount,l.net_amount,l.components,l.source,l.included,
      l.source_batch_id,l.source_row_no,l.source_row_hash
      FROM payroll_run_lines l JOIN payroll_submissions s ON s.id=l.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${where} ORDER BY s.period DESC,c.name,p.name,l.employee_name LIMIT 10000`, bindings);
    return respond({ ok: true, type, rows: rows.map((row) => ({ ...row, components: (() => { try { return JSON.parse(row.components || '{}'); } catch { return {}; } })() })) });
  }

  if (type === 'control') {
    const rows = await d1All(env.DB, `SELECT s.id AS submission_id,s.period,s.run_type,s.state,c.name AS client_name,p.name AS project_name,
      COUNT(CASE WHEN l.included=1 THEN 1 END) AS employee_count,
      COALESCE(SUM(CASE WHEN l.included=1 THEN l.gross_amount ELSE 0 END),0) AS payroll_gross,
      COALESCE(SUM(CASE WHEN l.included=1 THEN l.deduction_amount ELSE 0 END),0) AS payroll_deduction,
      COALESCE(SUM(CASE WHEN l.included=1 THEN l.net_amount ELSE 0 END),0) AS payroll_net,
      COALESCE((SELECT source_total_gross FROM payroll_upload_batches b WHERE b.submission_id=s.id AND b.status='IMPORTED' ORDER BY b.uploaded_at DESC LIMIT 1),0) AS source_gross,
      COALESCE((SELECT source_total_deduction FROM payroll_upload_batches b WHERE b.submission_id=s.id AND b.status='IMPORTED' ORDER BY b.uploaded_at DESC LIMIT 1),0) AS source_deduction,
      COALESCE((SELECT source_total_net FROM payroll_upload_batches b WHERE b.submission_id=s.id AND b.status='IMPORTED' ORDER BY b.uploaded_at DESC LIMIT 1),0) AS source_net,
      COALESCE((SELECT expected_total FROM payment_instructions pi WHERE pi.submission_id=s.id AND pi.status<>'REJECTED' ORDER BY pi.created_at DESC LIMIT 1),0) AS pi_total,
      COALESCE((SELECT SUM(pp.amount) FROM payment_proofs pp JOIN payment_instructions pi2 ON pi2.id=pp.payment_instruction_id WHERE pi2.submission_id=s.id),0) AS proof_total,
      COALESCE((SELECT r.difference FROM reconciliations r JOIN payment_instructions pi3 ON pi3.id=r.payment_instruction_id WHERE pi3.submission_id=s.id ORDER BY r.created_at DESC LIMIT 1),0) AS reconciliation_difference
      FROM payroll_submissions s JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      LEFT JOIN payroll_run_lines l ON l.submission_id=s.id WHERE ${where}
      GROUP BY s.id ORDER BY s.period DESC,s.created_at DESC LIMIT 2000`, bindings);
    return respond({ ok: true, type, rows });
  }

  if (type === 'uploads') {
    const rows = await d1All(env.DB, `SELECT b.*,c.name AS client_name,p.name AS project_name,s.period,s.run_type
      FROM payroll_upload_batches b JOIN payroll_submissions s ON s.id=b.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${where} ORDER BY b.uploaded_at DESC LIMIT 2000`, bindings);
    return respond({ ok: true, type, rows: rows.map((row) => ({ ...row, validation_summary: (() => { try { return JSON.parse(row.validation_summary || '{}'); } catch { return {}; } })() })) });
  }

  if (type === 'payslips') {
    const rows = await d1All(env.DB, `SELECT s.id AS submission_id,s.period,s.run_type,c.name AS client_name,p.name AS project_name,
      l.employee_id,l.employee_name,l.gross_amount,l.deduction_amount,l.net_amount,l.source_batch_id,
      pi.document_no,pi.status AS payment_status,r.status AS reconciliation_status
      FROM payroll_run_lines l JOIN payroll_submissions s ON s.id=l.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      JOIN payment_instructions pi ON pi.submission_id=s.id
      LEFT JOIN reconciliations r ON r.payment_instruction_id=pi.id
      WHERE ${where} AND l.included=1 AND pi.status='COMPLETED' AND COALESCE(r.status,'')='MATCHED'
      ORDER BY s.period DESC,l.employee_name LIMIT 10000`, bindings);
    return respond({ ok: true, type, rows });
  }

  if (type === 'exceptions') {
    const rows = await d1All(env.DB, `SELECT pe.*,s.period,s.run_type,c.name AS client_name,p.name AS project_name
      FROM payroll_exceptions pe JOIN payroll_submissions s ON s.id=pe.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${where} ORDER BY pe.created_at DESC LIMIT 5000`, bindings);
    return respond({ ok: true, type, rows });
  }

  return respond({ error: 'Unknown report type' }, 422);
}
