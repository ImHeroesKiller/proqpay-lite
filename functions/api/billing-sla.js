import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, clientIdsFor, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { MANUAL_SLA_TRIGGERS, validateSlaPolicyInput } from './billing-sla-core.js';
import { billingSlaSchemaAvailable, materializeInvoiceSla } from './billing-sla-service.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'];
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function orgId(env) { return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }
function processor(role) { return ['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role); }
function controller(role) { return ['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role); }
function canClient(actor, env, clientId) {
  const ids = clientIdsFor(actor, env);
  return ids === null || ids.includes(String(clientId));
}
function boundedText(value, max = 500) { const v = String(value || '').trim(); return v ? v.slice(0, max) : null; }
function validDate(value) { return DATE.test(String(value || '')); }

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET','POST'].includes(request.method)) return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ROLES, mutating: request.method === 'POST', methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'billing-sla', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 belum terhubung', requestId }, 503);
  const database = env.DB, actor = authorization.actor, organizationId = orgId(env);
  try {
    if (!(await billingSlaSchemaAvailable(database))) {
      return respond({ error: 'Migration Billing SLA belum terpasang', code: 'BILLING_SLA_SCHEMA_REQUIRED' }, 503);
    }
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const clientId = url.searchParams.get('clientId');
      const invoiceId = url.searchParams.get('invoiceId');
      if (clientId && !ID.test(clientId)) return respond({ error: 'clientId tidak valid' }, 422);
      if (invoiceId && !ID.test(invoiceId)) return respond({ error: 'invoiceId tidak valid' }, 422);
      if (clientId && !canClient(actor, env, clientId)) return respond({ error: 'Akses klien ditolak' }, 403);
      if (invoiceId) {
        const invoice = await d1First(database, 'SELECT * FROM invoices WHERE id=? AND org_id=? LIMIT 1', [invoiceId, organizationId]);
        if (!invoice) return respond({ error: 'Invoice tidak ditemukan' }, 404);
        if (!canClient(actor, env, invoice.client_id)) return respond({ error: 'Akses klien ditolak' }, 403);
        const evidence = await d1All(database, `SELECT * FROM billing_sla_evidence WHERE invoice_id=? AND org_id=?
          ORDER BY datetime(created_at) DESC`, [invoice.id, organizationId]);
        const policy = invoice.sla_policy_id
          ? await d1First(database, 'SELECT * FROM billing_sla_policies WHERE id=? AND org_id=? LIMIT 1', [invoice.sla_policy_id, organizationId])
          : null;
        return respond({ ok: true, invoice, policy, evidence });
      }
      const scopeIds = actor.role === 'CLIENT_USER' ? (clientIdsFor(actor, env) || []) : null;
      const scopeSql = scopeIds ? (scopeIds.length ? ` AND p.client_id IN (${scopeIds.map(() => '?').join(',')})` : ' AND 1=0') : '';
      const policies = await d1All(database, `SELECT p.*,c.name AS client_name,pr.name AS project_name
        FROM billing_sla_policies p JOIN clients c ON c.id=p.client_id LEFT JOIN projects pr ON pr.id=p.project_id
        WHERE p.org_id=?${clientId ? ' AND p.client_id=?' : ''}${scopeSql}
        ORDER BY p.client_id,p.project_id,datetime(p.effective_from) DESC`,
        [organizationId, ...(clientId ? [clientId] : []), ...(scopeIds || [])]);
      const calendarYears = actor.role === 'CLIENT_USER' ? [] : await d1All(database,
        `SELECT * FROM business_calendar_years WHERE country_code='ID' ORDER BY year DESC`);
      return respond({ ok: true, policies, calendarYears });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return respond({ error: 'JSON object required' }, 422);
    const action = String(body.action || '');

    if (action === 'UPSERT_SLA_POLICY') {
      if (!processor(actor.role)) return respond({ error: 'Hanya Super Admin atau Payroll Processor yang dapat mengubah SLA policy' }, 403);
      if (!ID.test(String(body.clientId || '')) || (body.projectId && !ID.test(String(body.projectId)))) return respond({ error: 'Scope SLA tidak valid' }, 422);
      const checked = validateSlaPolicyInput({ termsBusinessDays: body.termsBusinessDays, requiredTriggers: body.requiredTriggers, calendarMode: body.calendarMode });
      if (!checked.ok) return respond({ error: checked.errors.join('; ') }, 422);
      const client = await d1First(database, 'SELECT id FROM clients WHERE id=? AND org_id=? LIMIT 1', [body.clientId, organizationId]);
      if (!client) return respond({ error: 'Klien tidak ditemukan' }, 404);
      if (body.projectId) {
        const project = await d1First(database, 'SELECT id FROM projects WHERE id=? AND client_id=? AND org_id=? LIMIT 1', [body.projectId, body.clientId, organizationId]);
        if (!project) return respond({ error: 'Project tidak berada pada klien tersebut' }, 409);
      }
      const now = new Date().toISOString();
      const id = `SLA-${crypto.randomUUID()}`;
      await d1Batch(database, [
        { statement: `UPDATE billing_sla_policies SET status='INACTIVE',effective_until=?,updated_at=${NOW}
          WHERE org_id=? AND client_id=? AND status='ACTIVE' AND ((project_id IS NULL AND ? IS NULL) OR project_id=?)`,
          bindings: [now, organizationId, body.clientId, body.projectId || null, body.projectId || null] },
        { statement: `INSERT INTO billing_sla_policies
          (id,org_id,client_id,project_id,terms_business_days,required_triggers,calendar_mode,status,effective_from,created_by)
          VALUES(?,?,?,?,?,?,?,'ACTIVE',?,?)`,
          bindings: [id, organizationId, body.clientId, body.projectId || null, checked.termsBusinessDays,
            JSON.stringify(checked.requiredTriggers), checked.calendarMode, now, actor.email] },
        { statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?,?,?)`, bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role,
          'BILLING_SLA_POLICY_UPDATED', `${checked.termsBusinessDays} hari kerja · ${checked.requiredTriggers.join('+')} · ${checked.calendarMode}`,
          'billing_sla_policy', id] },
      ]);
      const policy = await d1First(database, 'SELECT * FROM billing_sla_policies WHERE id=?', [id]);
      return respond({ ok: true, policy }, 201);
    }

    if (action === 'RECORD_SLA_EVIDENCE') {
      if (!processor(actor.role)) return respond({ error: 'Hanya Super Admin atau Payroll Processor yang dapat mencatat evidence SLA' }, 403);
      const invoiceId = String(body.invoiceId || ''), triggerType = String(body.triggerType || '').toUpperCase();
      const occurredOn = String(body.occurredOn || ''), reference = boundedText(body.reference, 160);
      if (!ID.test(invoiceId) || !MANUAL_SLA_TRIGGERS.includes(triggerType) || !validDate(occurredOn) || !reference) return respond({ error: 'Evidence SLA tidak valid' }, 422);
      if (occurredOn > new Date().toISOString().slice(0, 10)) return respond({ error: 'Tanggal evidence tidak boleh di masa depan' }, 422);
      const invoice = await d1First(database, 'SELECT * FROM invoices WHERE id=? AND org_id=? LIMIT 1', [invoiceId, organizationId]);
      if (!invoice) return respond({ error: 'Invoice tidak ditemukan' }, 404);
      if (!['ISSUED'].includes(invoice.status) || invoice.sla_status === 'ACTIVE' || invoice.due_date) return respond({ error: 'Evidence hanya dapat dicatat sebelum SLA jatuh tempo dikunci' }, 409);
      const id = `SLE-${crypto.randomUUID()}`;
      await d1Batch(database, [
        { statement: `INSERT INTO billing_sla_evidence
          (id,org_id,client_id,project_id,invoice_id,payment_instruction_id,trigger_type,occurred_on,reference,note,status,recorded_by)
          VALUES(?,?,?,?,?,?,?,?,?,?,'RECORDED',?)`, bindings: [id, organizationId, invoice.client_id, invoice.project_id,
          invoice.id, invoice.payment_instruction_id, triggerType, occurredOn, reference, boundedText(body.note, 1000), actor.email] },
        { statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?,?,?)`, bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role,
          'BILLING_SLA_EVIDENCE_RECORDED', `${triggerType} · ${occurredOn} · ${reference}`, 'billing_sla_evidence', id] },
      ]);
      return respond({ ok: true, evidence: await d1First(database, 'SELECT * FROM billing_sla_evidence WHERE id=?', [id]) }, 201);
    }

    if (action === 'VERIFY_SLA_EVIDENCE' || action === 'REJECT_SLA_EVIDENCE') {
      if (!controller(actor.role)) return respond({ error: 'Hanya Super Admin atau Payroll Controller yang dapat memverifikasi evidence SLA' }, 403);
      const evidenceId = String(body.evidenceId || '');
      if (!ID.test(evidenceId)) return respond({ error: 'evidenceId tidak valid' }, 422);
      const evidence = await d1First(database, 'SELECT * FROM billing_sla_evidence WHERE id=? AND org_id=? LIMIT 1', [evidenceId, organizationId]);
      if (!evidence) return respond({ error: 'Evidence tidak ditemukan' }, 404);
      if (evidence.status !== 'RECORDED') return respond({ error: 'Evidence sudah diproses' }, 409);
      if (String(evidence.recorded_by).toLowerCase() === String(actor.email).toLowerCase()) return respond({ error: 'Maker tidak boleh memverifikasi evidence sendiri' }, 409);
      const verified = action === 'VERIFY_SLA_EVIDENCE';
      const note = boundedText(body.note, 1000);
      await d1Batch(database, [
        { statement: `UPDATE billing_sla_evidence SET status=?,verified_by=?,verified_at=${NOW},note=COALESCE(?,note) WHERE id=? AND status='RECORDED'`,
          bindings: [verified ? 'VERIFIED' : 'REJECTED', actor.email, note, evidence.id] },
        { statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?,?,?)`, bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role,
          verified ? 'BILLING_SLA_EVIDENCE_VERIFIED' : 'BILLING_SLA_EVIDENCE_REJECTED', note || evidence.trigger_type,
          'billing_sla_evidence', evidence.id] },
      ]);
      const materialized = verified ? await materializeInvoiceSla(database, organizationId, evidence.invoice_id) : null;
      return respond({ ok: true, evidence: await d1First(database, 'SELECT * FROM billing_sla_evidence WHERE id=?', [evidence.id]), materialized });
    }

    if (action === 'UPSERT_CALENDAR_YEAR') {
      if (actor.role !== 'SUPER_ADMIN') return respond({ error: 'Hanya Super Admin yang dapat mengelola business calendar' }, 403);
      const year = Number(body.year), status = String(body.status || '').toUpperCase(), sourceReference = boundedText(body.sourceReference, 500);
      if (!Number.isSafeInteger(year) || year < 2000 || year > 2100 || !['OFFICIAL','PROVISIONAL'].includes(status)) return respond({ error: 'Calendar year tidak valid' }, 422);
      await d1Batch(database, [{ statement: `INSERT INTO business_calendar_years(country_code,year,status,source_reference)
        VALUES('ID',?,?,?) ON CONFLICT(country_code,year) DO UPDATE SET status=excluded.status,source_reference=excluded.source_reference,updated_at=${NOW}`,
        bindings: [year, status, sourceReference] }]);
      return respond({ ok: true, year, status });
    }

    if (action === 'UPSERT_CALENDAR_DAY') {
      if (actor.role !== 'SUPER_ADMIN') return respond({ error: 'Hanya Super Admin yang dapat mengelola business calendar' }, 403);
      const calendarDate = String(body.calendarDate || ''), dayType = String(body.dayType || '').toUpperCase();
      if (!validDate(calendarDate) || !['NATIONAL_HOLIDAY','COMPANY_HOLIDAY','COLLECTIVE_LEAVE'].includes(dayType) || typeof body.isBusinessDay !== 'boolean' || !boundedText(body.name, 200)) return respond({ error: 'Calendar day tidak valid' }, 422);
      const year = Number(calendarDate.slice(0, 4));
      const calendarYear = await d1First(database, `SELECT * FROM business_calendar_years WHERE country_code='ID' AND year=? LIMIT 1`, [year]);
      if (!calendarYear) return respond({ error: `Calendar year ${year} belum dibuat` }, 409);
      await d1Batch(database, [{ statement: `INSERT INTO business_calendar_days
        (country_code,calendar_year,calendar_date,name,day_type,is_business_day,source_reference)
        VALUES('ID',?,?,?,?,?,?) ON CONFLICT(country_code,calendar_date) DO UPDATE SET
        calendar_year=excluded.calendar_year,name=excluded.name,day_type=excluded.day_type,is_business_day=excluded.is_business_day,source_reference=excluded.source_reference`,
        bindings: [year, calendarDate, boundedText(body.name, 200), dayType, body.isBusinessDay ? 1 : 0, boundedText(body.sourceReference, 500)] }]);
      return respond({ ok: true, calendarDate });
    }

    return respond({ error: 'Action tidak dikenal' }, 422);
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
