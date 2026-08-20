import { neon } from '@neondatabase/serverless';
import {
  authorize,
  enforceRateLimit,
  handlePreflight,
  publicError,
  secureJson,
} from './_security.js';
import { MAX_JSON_BYTES, validateBusinessState } from './state-validation.js';

const METHODS = 'GET, POST, OPTIONS';
const ORG_ID = 'ORG-OTSINDO';

function getUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER'],
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(
    request, env, authorization.actor, 'business-state', METHODS
  );
  if (limited) return limited;

  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  const url = getUrl(env);
  if (!url) return respond({ error: 'Service unavailable', requestId }, 503);
  const sql = neon(url);

  try {
    if (request.method === 'GET') {
      const [payrolls, approvals, invoices, arMonitor, auditLogs] =
        await Promise.all([
          sql`SELECT * FROM payrolls WHERE org_id = ${ORG_ID} ORDER BY period DESC LIMIT 120`,
          sql`SELECT * FROM approvals WHERE org_id = ${ORG_ID} ORDER BY approved_at DESC LIMIT 500`,
          sql`SELECT i.*, COALESCE(c.name, i.company) AS resolved_company FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.org_id = ${ORG_ID} ORDER BY i.issued_at DESC NULLS LAST LIMIT 500`,
          sql`SELECT * FROM ar_monitor WHERE org_id = ${ORG_ID} ORDER BY due_date DESC NULLS LAST LIMIT 500`,
          sql`SELECT * FROM audit_logs WHERE org_id = ${ORG_ID} ORDER BY timestamp DESC LIMIT 500`,
        ]);
      return respond({
        ok: true,
        state: {
          payrolls: payrolls.map((p) => ({
            id: p.id, period: p.period, status: p.status,
            createdAt: new Date(p.created_at).getTime(),
            summary: {
              employeeCount: p.employee_count,
              totalGross: Number(p.total_gross),
              totalDeduction: Number(p.total_deduction),
              totalNet: Number(p.total_net),
            },
            details: p.details || [],
          })),
          approvals: approvals.map((a) => ({
            id: a.id, payrollId: a.payroll_id, period: a.period,
            approvedBy: a.approved_by, status: a.status,
            approvedAt: a.approved_at ? new Date(a.approved_at).getTime() : null,
          })),
          payments: [],
          invoices: invoices.map((i) => ({
            id: i.id, company: i.resolved_company || i.client_id || 'Client',
            period: i.period, amount: Number(i.amount), taxAmount: Number(i.tax_amount),
            totalAmount: Number(i.total_amount), status: i.status,
            issuedAt: i.issued_at ? new Date(i.issued_at).getTime() : null,
            paidAt: i.paid_at ? new Date(i.paid_at).getTime() : null,
            items: i.items || [],
          })),
          arMonitor: arMonitor.map((a) => ({
            id: a.id, company: a.company, invoiceId: a.invoice_id,
            amount: Number(a.amount), status: a.status,
            dueDate: a.due_date ? new Date(a.due_date).getTime() : null,
            daysOverdue: a.days_overdue, type: a.type, notes: a.notes,
          })),
          auditLogs: auditLogs.map((a) => ({
            id: a.id, timestamp: new Date(a.timestamp).getTime(),
            user: a.username, role: a.role, action: a.action, detail: a.detail,
            entity: a.entity, entityId: a.entity_id,
          })),
        },
      });
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_JSON_BYTES) return respond({ error: 'Payload too large' }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) {
      return respond({ error: 'Payload too large' }, 413);
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return respond({ error: 'Invalid JSON' }, 400);
    }
    const validated = validateBusinessState(body.state);
    if (!validated.ok) return respond({ error: validated.error }, 422);
    const state = validated.state;

    const clients = await sql`SELECT id, name FROM clients WHERE org_id = ${ORG_ID}`;
    const clientIds = new Map(clients.map((c) => [String(c.name).toLowerCase(), c.id]));
    await sql.transaction((tx) => {
      const queries = [];
      for (const p of state.payrolls) {
        queries.push(tx`
          INSERT INTO payrolls (id, org_id, period, status, total_gross, total_deduction, total_net, employee_count, details, created_at, updated_at)
          VALUES (${p.id}, ${ORG_ID}, ${p.period}, ${p.status || 'DRAFT'}, ${p.summary?.totalGross || 0}, ${p.summary?.totalDeduction || 0}, ${p.summary?.totalNet || 0}, ${p.summary?.employeeCount || 0}, ${JSON.stringify(p.details || [])}::jsonb, ${iso(p.createdAt) || new Date().toISOString()}, NOW())
          ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, total_gross=EXCLUDED.total_gross, total_deduction=EXCLUDED.total_deduction, total_net=EXCLUDED.total_net, employee_count=EXCLUDED.employee_count, details=EXCLUDED.details, updated_at=NOW()
        `);
      }
      for (const a of state.approvals) {
        queries.push(tx`
          INSERT INTO approvals (id, org_id, payroll_id, period, approved_by, status, approved_at)
          VALUES (${a.id}, ${ORG_ID}, ${a.payrollId || null}, ${a.period || null}, ${authorization.actor.email}, ${a.status || 'APPROVED'}, ${iso(a.approvedAt)})
          ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, approved_by=EXCLUDED.approved_by, approved_at=EXCLUDED.approved_at
        `);
      }
      for (const i of state.invoices) {
        const clientId = clientIds.get(String(i.company || '').toLowerCase()) || null;
        queries.push(tx`
          INSERT INTO invoices (id, org_id, client_id, company, period, amount, tax_amount, total_amount, status, issued_at, paid_at, items)
          VALUES (${i.id}, ${ORG_ID}, ${clientId}, ${i.company || null}, ${i.period || null}, ${i.amount || 0}, ${i.taxAmount || 0}, ${i.totalAmount || 0}, ${i.status || 'DRAFT'}, ${iso(i.issuedAt)}, ${iso(i.paidAt)}, ${JSON.stringify(i.items || [])}::jsonb)
          ON CONFLICT (id) DO UPDATE SET company=EXCLUDED.company, status=EXCLUDED.status, amount=EXCLUDED.amount, tax_amount=EXCLUDED.tax_amount, total_amount=EXCLUDED.total_amount, paid_at=EXCLUDED.paid_at, items=EXCLUDED.items
        `);
      }
      for (const a of state.arMonitor) {
        queries.push(tx`
          INSERT INTO ar_monitor (id, org_id, company, invoice_id, amount, status, due_date, days_overdue, type, notes)
          VALUES (${a.id}, ${ORG_ID}, ${a.company || null}, ${a.invoiceId || null}, ${a.amount || 0}, ${a.status || 'OUTSTANDING'}, ${iso(a.dueDate)}, ${a.daysOverdue || 0}, ${a.type || null}, ${a.notes || null})
          ON CONFLICT (id) DO UPDATE SET amount=EXCLUDED.amount, status=EXCLUDED.status, due_date=EXCLUDED.due_date, days_overdue=EXCLUDED.days_overdue, notes=EXCLUDED.notes
        `);
      }
      for (const a of state.auditLogs) {
        queries.push(tx`
          INSERT INTO audit_logs (id, org_id, timestamp, username, role, action, detail, entity, entity_id)
          VALUES (${a.id}, ${ORG_ID}, ${iso(a.timestamp) || new Date().toISOString()}, ${authorization.actor.email}, ${authorization.actor.role}, ${a.action || 'STATE_SYNC'}, ${a.detail || null}, ${a.entity || null}, ${a.entityId || null})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      return queries;
    });
    return respond({ ok: true, persisted: true });
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
