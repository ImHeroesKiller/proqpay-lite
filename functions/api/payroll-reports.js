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

function pageRows(rows, offset, limit) {
  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;
  return { page, meta: { offset, limit, returned: page.length, nextOffset: truncated ? offset + limit : null, truncated } };
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return secureJson({ error: 'GET only' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ROLES, mutating: false, methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'payroll-reports', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Layanan laporan payroll belum tersedia. Hubungi administrator.', code: 'REPORT_DATA_UNAVAILABLE' }, 503);

  const params = new URL(request.url).searchParams;
  const type = String(params.get('type') || 'register').toLowerCase();
  const period = params.get('period');
  const clientId = params.get('clientId');
  const status = String(params.get('status') || '').trim();
  const query = String(params.get('q') || '').trim().slice(0,120);
  const offset = Math.max(0, Number.parseInt(params.get('offset') || '0', 10) || 0);
  const limit = Math.min(500, Math.max(1, Number.parseInt(params.get('limit') || '200', 10) || 200));
  const base = scopeSql(authorization.actor, env, 's');
  if (base.denied) return respond({ ok: true, type, rows: [], meta: { offset, limit, returned: 0, nextOffset: null, truncated: false } });
  const scopeClauses = [base.sql];
  const scopeBindings = [...base.bindings];
  if (clientId) { scopeClauses.push('s.client_id=?'); scopeBindings.push(clientId); }
  const scopeWhere = scopeClauses.join(' AND ');
  const clauses = [...scopeClauses];
  const bindings = [...scopeBindings];
  if (period && /^\d{4}-\d{2}$/.test(period)) { clauses.push('s.period=?'); bindings.push(period); }
  const paging = [limit + 1, offset];

  const periods = (await d1All(env.DB,`SELECT DISTINCT s.period FROM payroll_submissions s
    WHERE ${scopeWhere} AND s.period IS NOT NULL AND s.period<>'' ORDER BY s.period DESC LIMIT 120`,scopeBindings))
    .map((row)=>String(row.period));
  const facets = { periods, statuses: [] };

  if (type === 'register') {
    const reportClauses=[...clauses];
    const reportBindings=[...bindings];
    if(status){reportClauses.push('s.state=?');reportBindings.push(status);}
    if(query){reportClauses.push("(LOWER(COALESCE(l.employee_name,'')) LIKE ? OR LOWER(COALESCE(l.employee_code,'')) LIKE ? OR LOWER(COALESCE(l.employee_id,'')) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(COALESCE(p.name,'')) LIKE ? OR LOWER(s.id) LIKE ?)");const like=`%${query.toLowerCase()}%`;reportBindings.push(like,like,like,like,like,like);}
    facets.statuses=(await d1All(env.DB,`SELECT DISTINCT s.state AS status FROM payroll_submissions s WHERE ${scopeWhere} AND s.state IS NOT NULL ORDER BY s.state`,scopeBindings)).map((row)=>String(row.status));
    const where=reportClauses.join(' AND ');
    const rows = await d1All(env.DB, `SELECT s.id AS submission_id,s.period,s.payment_period,s.run_type,s.source_mode,s.state,
      c.name AS client_name,p.name AS project_name,l.employee_id,l.employee_code,l.employee_name,l.employment_status,
      l.gross_amount,l.deduction_amount,l.net_amount,l.components,l.source,l.included,
      l.source_batch_id,l.source_row_no,l.source_row_hash
      FROM payroll_run_lines l JOIN payroll_submissions s ON s.id=l.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${where} AND l.included=1
      ORDER BY s.period DESC,c.name,p.name,l.employee_name,l.employee_id,s.id LIMIT ? OFFSET ?`, [...reportBindings, ...paging]);
    const { page, meta } = pageRows(rows, offset, limit);
    return respond({ ok: true, type, rows: page.map((row) => ({ ...row, components: parseJson(row.components, {}) })), meta, facets });
  }

  if (type === 'control') {
    const reportClauses=[...clauses];
    const reportBindings=[...bindings];
    if(status){reportClauses.push('s.state=?');reportBindings.push(status);}
    if(query){reportClauses.push("(LOWER(c.name) LIKE ? OR LOWER(COALESCE(p.name,'')) LIKE ? OR LOWER(s.id) LIKE ?)");const like=`%${query.toLowerCase()}%`;reportBindings.push(like,like,like);}
    facets.statuses=(await d1All(env.DB,`SELECT DISTINCT s.state AS status FROM payroll_submissions s WHERE ${scopeWhere} AND s.state IS NOT NULL ORDER BY s.state`,scopeBindings)).map((row)=>String(row.status));
    const where=reportClauses.join(' AND ');
    const rows = await d1All(env.DB, `SELECT s.id AS submission_id,s.period,s.run_type,s.state,c.name AS client_name,p.name AS project_name,
      COUNT(CASE WHEN l.included=1 THEN 1 END) AS employee_count,
      COALESCE(SUM(CASE WHEN l.included=1 THEN l.gross_amount ELSE 0 END),0) AS payroll_gross,
      COALESCE(SUM(CASE WHEN l.included=1 THEN l.deduction_amount ELSE 0 END),0) AS payroll_deduction,
      COALESCE(SUM(CASE WHEN l.included=1 THEN l.net_amount ELSE 0 END),0) AS payroll_net,
      COALESCE((SELECT source_total_gross FROM payroll_upload_batches b WHERE b.submission_id=s.id AND b.status='IMPORTED' ORDER BY b.uploaded_at DESC,b.id DESC LIMIT 1),0) AS source_gross,
      COALESCE((SELECT source_total_deduction FROM payroll_upload_batches b WHERE b.submission_id=s.id AND b.status='IMPORTED' ORDER BY b.uploaded_at DESC,b.id DESC LIMIT 1),0) AS source_deduction,
      COALESCE((SELECT source_total_net FROM payroll_upload_batches b WHERE b.submission_id=s.id AND b.status='IMPORTED' ORDER BY b.uploaded_at DESC,b.id DESC LIMIT 1),0) AS source_net,
      COALESCE((SELECT expected_total FROM payment_instructions pi WHERE pi.submission_id=s.id AND pi.status<>'REJECTED' ORDER BY pi.updated_at DESC,pi.created_at DESC,pi.id DESC LIMIT 1),0) AS pi_total,
      COALESCE((SELECT SUM(pp.amount) FROM payment_proofs pp
        WHERE pp.payment_instruction_id=(SELECT pi2.id FROM payment_instructions pi2
          WHERE pi2.submission_id=s.id AND pi2.status<>'REJECTED'
          ORDER BY pi2.updated_at DESC,pi2.created_at DESC,pi2.id DESC LIMIT 1)),0) AS proof_total,
      COALESCE((SELECT r.difference FROM reconciliations r
        WHERE r.payment_instruction_id=(SELECT pi3.id FROM payment_instructions pi3
          WHERE pi3.submission_id=s.id AND pi3.status<>'REJECTED'
          ORDER BY pi3.updated_at DESC,pi3.created_at DESC,pi3.id DESC LIMIT 1)
        ORDER BY r.created_at DESC,r.id DESC LIMIT 1),0) AS reconciliation_difference
      FROM payroll_submissions s JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      LEFT JOIN payroll_run_lines l ON l.submission_id=s.id WHERE ${where}
      GROUP BY s.id ORDER BY s.period DESC,s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`, [...reportBindings, ...paging]);
    const { page, meta } = pageRows(rows, offset, limit);
    return respond({ ok: true, type, rows: page, meta, facets });
  }

  if (type === 'uploads') {
    const reportClauses=[...clauses];
    const reportBindings=[...bindings];
    if(status){reportClauses.push('b.status=?');reportBindings.push(status);}
    if(query){reportClauses.push("(LOWER(COALESCE(b.original_filename,'')) LIKE ? OR LOWER(COALESCE(b.file_sha256,'')) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(COALESCE(p.name,'')) LIKE ? OR LOWER(s.id) LIKE ?)");const like=`%${query.toLowerCase()}%`;reportBindings.push(like,like,like,like,like);}
    facets.statuses=(await d1All(env.DB,`SELECT DISTINCT b.status FROM payroll_upload_batches b JOIN payroll_submissions s ON s.id=b.submission_id WHERE ${scopeWhere} AND b.status IS NOT NULL ORDER BY b.status`,scopeBindings)).map((row)=>String(row.status));
    const where=reportClauses.join(' AND ');
    const rows = await d1All(env.DB, `SELECT b.*,c.name AS client_name,p.name AS project_name,s.period,s.run_type
      FROM payroll_upload_batches b JOIN payroll_submissions s ON s.id=b.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${where} ORDER BY b.uploaded_at DESC,b.id DESC LIMIT ? OFFSET ?`, [...reportBindings, ...paging]);
    const { page, meta } = pageRows(rows, offset, limit);
    return respond({ ok: true, type, rows: page.map((row) => ({ ...row, validation_summary: parseJson(row.validation_summary, {}) })), meta, facets });
  }

  if (type === 'payslips') {
    const reportClauses=[...clauses];
    const reportBindings=[...bindings];
    if(status){reportClauses.push('pi.status=?');reportBindings.push(status);}
    if(query){reportClauses.push("(LOWER(COALESCE(l.employee_name,'')) LIKE ? OR LOWER(COALESCE(l.employee_id,'')) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(COALESCE(p.name,'')) LIKE ? OR LOWER(COALESCE(pi.document_no,'')) LIKE ?)");const like=`%${query.toLowerCase()}%`;reportBindings.push(like,like,like,like,like);}
    facets.statuses=(await d1All(env.DB,`SELECT DISTINCT pi.status FROM payment_instructions pi JOIN payroll_submissions s ON s.id=pi.submission_id LEFT JOIN reconciliations r ON r.payment_instruction_id=pi.id WHERE ${scopeWhere} AND pi.status='COMPLETED' AND COALESCE(r.status,'')='MATCHED' ORDER BY pi.status`,scopeBindings)).map((row)=>String(row.status));
    const where=reportClauses.join(' AND ');
    const rows = await d1All(env.DB, `SELECT s.id AS submission_id,s.period,s.run_type,c.name AS client_name,p.name AS project_name,
      l.employee_id,l.employee_name,l.gross_amount,l.deduction_amount,l.net_amount,l.source_batch_id,
      pi.document_no,pi.status AS payment_status,r.status AS reconciliation_status
      FROM payroll_run_lines l JOIN payroll_submissions s ON s.id=l.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      JOIN payment_instructions pi ON pi.submission_id=s.id
      LEFT JOIN reconciliations r ON r.payment_instruction_id=pi.id
      WHERE ${where} AND l.included=1 AND pi.status='COMPLETED' AND COALESCE(r.status,'')='MATCHED'
      ORDER BY s.period DESC,l.employee_name,l.employee_id,s.id LIMIT ? OFFSET ?`, [...reportBindings, ...paging]);
    const { page, meta } = pageRows(rows, offset, limit);
    return respond({ ok: true, type, rows: page, meta, facets });
  }

  if (type === 'exceptions') {
    const reportClauses=[...clauses];
    const reportBindings=[...bindings];
    if(status){reportClauses.push('pe.status=?');reportBindings.push(status);}
    if(query){reportClauses.push("(LOWER(COALESCE(pe.employee_id,'')) LIKE ? OR LOWER(COALESCE(pe.code,'')) LIKE ? OR LOWER(COALESCE(pe.message,'')) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(COALESCE(p.name,'')) LIKE ? OR LOWER(s.id) LIKE ?)");const like=`%${query.toLowerCase()}%`;reportBindings.push(like,like,like,like,like,like);}
    facets.statuses=(await d1All(env.DB,`SELECT DISTINCT pe.status FROM payroll_exceptions pe JOIN payroll_submissions s ON s.id=pe.submission_id WHERE ${scopeWhere} AND pe.status IS NOT NULL ORDER BY pe.status`,scopeBindings)).map((row)=>String(row.status));
    const where=reportClauses.join(' AND ');
    const rows = await d1All(env.DB, `SELECT pe.*,s.period,s.run_type,c.name AS client_name,p.name AS project_name
      FROM payroll_exceptions pe JOIN payroll_submissions s ON s.id=pe.submission_id
      JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=s.project_id
      WHERE ${where} ORDER BY pe.created_at DESC,pe.id DESC LIMIT ? OFFSET ?`, [...reportBindings, ...paging]);
    const { page, meta } = pageRows(rows, offset, limit);
    return respond({ ok: true, type, rows: page, meta, facets });
  }

  return respond({ error: 'Unknown report type' }, 422);
}
