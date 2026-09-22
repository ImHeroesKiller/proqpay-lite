import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, clientIdsFor, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { isValidSlaDate, MANUAL_SLA_TRIGGERS, normalizeRequiredTriggers, validateSlaPolicyInput } from './billing-sla-core.js';
import { billingSlaSchemaAvailable, materializeInvoiceSla } from './billing-sla-service.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'];
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function orgId(env) { return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }
function processor(role) { return ['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role); }
function controller(role) { return ['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role); }
function canClient(actor, env, clientId) {
  const ids = clientIdsFor(actor, env);
  return ids === null || ids.includes(String(clientId));
}
function boundedText(value, max = 500) { const v = String(value || '').trim(); return v ? v.slice(0, max) : null; }
function validDate(value) { return isValidSlaDate(value); }
function businessDate(env) {
  const timeZone = String(env.BILLING_TIME_ZONE || 'Asia/Jakarta');
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function samePolicy(policy, checked) {
  if (!policy) return false;
  const currentTriggers = normalizeRequiredTriggers(JSON.parse(policy.required_triggers || '[]'));
  return Number(policy.terms_business_days) === checked.termsBusinessDays
    && String(policy.calendar_mode) === checked.calendarMode
    && JSON.stringify([...(currentTriggers || [])].sort()) === JSON.stringify([...checked.requiredTriggers].sort());
}

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
      const current = await d1First(database, `SELECT * FROM billing_sla_policies WHERE org_id=? AND client_id=? AND status='ACTIVE'
        AND ((project_id IS NULL AND ? IS NULL) OR project_id=?) LIMIT 1`,
        [organizationId, body.clientId, body.projectId || null, body.projectId || null]);
      if (samePolicy(current, checked)) return respond({ ok: true, policy: current, idempotentReplay: true });

      const now = new Date().toISOString();
      const id = `SLA-${crypto.randomUUID()}`;
      const operations = [];
      if (current) operations.push({ statement: `UPDATE billing_sla_policies SET status='INACTIVE',effective_until=?,updated_at=${NOW}
        WHERE id=? AND org_id=? AND status='ACTIVE'`, bindings: [now, current.id, organizationId] });
      operations.push(
        { statement: `INSERT INTO billing_sla_policies
          (id,org_id,client_id,project_id,terms_business_days,required_triggers,calendar_mode,status,effective_from,created_by)
          VALUES(?,?,?,?,?,?,?,'ACTIVE',?,?)`,
          bindings: [id, organizationId, body.clientId, body.projectId || null, checked.termsBusinessDays,
            JSON.stringify(checked.requiredTriggers), checked.calendarMode, now, actor.email] },
        { statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?,?,?)`, bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role,
          'BILLING_SLA_POLICY_UPDATED', `${checked.termsBusinessDays} hari kerja · ${checked.requiredTriggers.join('+')} · ${checked.calendarMode}`,
          'billing_sla_policy', id] },
      );
      try {
        await d1Batch(database, operations);
      } catch (error) {
        if (/idx_one_active_(?:client|project)_sla_policy|UNIQUE constraint failed: billing_sla_policies/i.test(String(error?.message || error))) {
          return respond({ error: 'SLA policy berubah bersamaan. Muat ulang sebelum menyimpan lagi.', code: 'SLA_POLICY_CONCURRENT_UPDATE' }, 409);
        }
        throw error;
      }
      const policy = await d1First(database, 'SELECT * FROM billing_sla_policies WHERE id=?', [id]);
      return respond({ ok: true, policy }, 201);
    }

    if (action === 'RECORD_SLA_EVIDENCE') {
      if (!processor(actor.role)) return respond({ error: 'Hanya Super Admin atau Payroll Processor yang dapat mencatat evidence SLA' }, 403);
      const invoiceId = String(body.invoiceId || ''), triggerType = String(body.triggerType || '').toUpperCase();
      const occurredOn = String(body.occurredOn || ''), reference = boundedText(body.reference, 160);
      if (!ID.test(invoiceId) || !MANUAL_SLA_TRIGGERS.includes(triggerType) || !validDate(occurredOn) || !reference) return respond({ error: 'Evidence SLA tidak valid' }, 422);
      if (occurredOn > businessDate(env)) return respond({ error: 'Tanggal evidence tidak boleh di masa depan' }, 422);
      const invoice = await d1First(database, 'SELECT * FROM invoices WHERE id=? AND org_id=? LIMIT 1', [invoiceId, organizationId]);
      if (!invoice) return respond({ error: 'Invoice tidak ditemukan' }, 404);
      if (invoice.status !== 'ISSUED' || invoice.sla_status === 'ACTIVE' || invoice.due_date) return respond({ error: 'Evidence hanya dapat dicatat sebelum SLA jatuh tempo dikunci' }, 409);
      const existingEvidence = await d1First(database, `SELECT * FROM billing_sla_evidence WHERE invoice_id=? AND trigger_type=? AND reference=?
        AND status IN ('RECORDED','VERIFIED') ORDER BY datetime(created_at) DESC LIMIT 1`, [invoice.id, triggerType, reference]);
      if (existingEvidence && existingEvidence.occurred_on === occurredOn) {
        return respond({ ok: true, evidence: existingEvidence, idempotentReplay: true });
      }
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
      const verified = action === 'VERIFY_SLA_EVIDENCE';
      const targetStatus = verified ? 'VERIFIED' : 'REJECTED';
      if (evidence.status === targetStatus && String(evidence.verified_by || '').toLowerCase() === String(actor.email).toLowerCase()) {
        const materialized = verified ? await materializeInvoiceSla(database, organizationId, evidence.invoice_id) : null;
        return respond({ ok: true, evidence, materialized, idempotentReplay: true });
      }
      if (evidence.status !== 'RECORDED') return respond({ error: 'Evidence sudah diproses oleh reviewer lain' }, 409);
      if (String(evidence.recorded_by).toLowerCase() === String(actor.email).toLowerCase()) return respond({ error: 'Maker tidak boleh memverifikasi evidence sendiri' }, 409);
      const note = boundedText(body.note, 1000);
      const auditAction = verified ? 'BILLING_SLA_EVIDENCE_VERIFIED' : 'BILLING_SLA_EVIDENCE_REJECTED';
      await d1Batch(database, [
        { statement: `UPDATE billing_sla_evidence SET status=?,verified_by=?,verified_at=${NOW},note=COALESCE(?,note)
          WHERE id=? AND org_id=? AND status='RECORDED'`, bindings: [targetStatus, actor.email, note, evidence.id, organizationId] },
        { statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          SELECT ?,?,?,?,?,?,?,? FROM billing_sla_evidence e WHERE e.id=? AND e.org_id=? AND e.status=? AND lower(e.verified_by)=lower(?)
          AND NOT EXISTS(SELECT 1 FROM audit_logs al WHERE al.org_id=? AND al.action=? AND al.entity='billing_sla_evidence' AND al.entity_id=?)`,
          bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role, auditAction, note || evidence.trigger_type,
            'billing_sla_evidence', evidence.id, evidence.id, organizationId, targetStatus, actor.email,
            organizationId, auditAction, evidence.id] },
      ]);
      const decided = await d1First(database, 'SELECT * FROM billing_sla_evidence WHERE id=? AND org_id=? LIMIT 1', [evidence.id, organizationId]);
      if (decided?.status !== targetStatus || String(decided?.verified_by || '').toLowerCase() !== String(actor.email).toLowerCase()) {
        return respond({ error: 'Evidence diproses bersamaan oleh reviewer lain. Muat ulang status.', code: 'SLA_EVIDENCE_CONCURRENT_DECISION' }, 409);
      }
      const materialized = verified ? await materializeInvoiceSla(database, organizationId, evidence.invoice_id) : null;
      return respond({ ok: true, evidence: decided, materialized });
    }

    if (action === 'UPSERT_CALENDAR_YEAR') {
      if (actor.role !== 'SUPER_ADMIN') return respond({ error: 'Hanya Super Admin yang dapat mengelola business calendar' }, 403);
      const year = Number(body.year), status = String(body.status || '').toUpperCase(), sourceReference = boundedText(body.sourceReference, 500);
      const expectedCount = body.expectedNationalHolidayCount == null ? null : Number(body.expectedNationalHolidayCount);
      if (!Number.isSafeInteger(year) || year < 2000 || year > 2100 || !['OFFICIAL','PROVISIONAL'].includes(status)
        || (expectedCount !== null && (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 366))) {
        return respond({ error: 'Calendar year tidak valid' }, 422);
      }
      if (status === 'OFFICIAL') {
        if (!sourceReference || expectedCount === null) return respond({ error: 'Calendar OFFICIAL wajib memiliki sumber dan expected holiday count' }, 422);
        const actual = await d1First(database, `SELECT COUNT(*) AS count FROM business_calendar_days
          WHERE country_code='ID' AND calendar_year=? AND day_type='NATIONAL_HOLIDAY'`, [year]);
        if (Number(actual?.count || 0) !== expectedCount) {
          return respond({ error: `Calendar ${year} belum lengkap: ${Number(actual?.count || 0)}/${expectedCount} national holiday`, code: 'BUSINESS_CALENDAR_INCOMPLETE' }, 409);
        }
      }
      await d1Batch(database, [
        { statement: `INSERT INTO business_calendar_years(country_code,year,status,expected_national_holiday_count,source_reference)
          VALUES('ID',?,?,?,?) ON CONFLICT(country_code,year) DO UPDATE SET status=excluded.status,
          expected_national_holiday_count=excluded.expected_national_holiday_count,source_reference=excluded.source_reference,updated_at=${NOW}`,
          bindings: [year, status, expectedCount, sourceReference] },
        { statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?,?,?)`, bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role,
          'BUSINESS_CALENDAR_YEAR_UPDATED', `${year} · ${status} · expected=${expectedCount ?? '-'}`,
          'business_calendar_year', `ID:${year}`] },
      ]);
      return respond({ ok: true, year, status, expectedNationalHolidayCount: expectedCount });
    }

    if (action === 'UPSERT_CALENDAR_DAY') {
      if (actor.role !== 'SUPER_ADMIN') return respond({ error: 'Hanya Super Admin yang dapat mengelola business calendar' }, 403);
      const calendarDate = String(body.calendarDate || ''), dayType = String(body.dayType || '').toUpperCase();
      if (!validDate(calendarDate) || !['NATIONAL_HOLIDAY','COMPANY_HOLIDAY','COLLECTIVE_LEAVE'].includes(dayType)
        || typeof body.isBusinessDay !== 'boolean' || !boundedText(body.name, 200)) return respond({ error: 'Calendar day tidak valid' }, 422);
      if (dayType === 'NATIONAL_HOLIDAY' && body.isBusinessDay) return respond({ error: 'National holiday tidak boleh ditandai sebagai business day' }, 422);
      const year = Number(calendarDate.slice(0, 4));
      const calendarYear = await d1First(database, `SELECT * FROM business_calendar_years WHERE country_code='ID' AND year=? LIMIT 1`, [year]);
      if (!calendarYear) return respond({ error: `Calendar year ${year} belum dibuat` }, 409);
      await d1Batch(database, [
        { statement: `INSERT INTO business_calendar_days
          (country_code,calendar_year,calendar_date,name,day_type,is_business_day,source_reference)
          VALUES('ID',?,?,?,?,?,?) ON CONFLICT(country_code,calendar_date) DO UPDATE SET
          calendar_year=excluded.calendar_year,name=excluded.name,day_type=excluded.day_type,is_business_day=excluded.is_business_day,source_reference=excluded.source_reference`,
          bindings: [year, calendarDate, boundedText(body.name, 200), dayType, body.isBusinessDay ? 1 : 0, boundedText(body.sourceReference, 500)] },
        { statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?,?,?)`, bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role,
          'BUSINESS_CALENDAR_DAY_UPDATED', `${calendarDate} · ${dayType} · business=${body.isBusinessDay ? 1 : 0}`,
          'business_calendar_day', `ID:${calendarDate}`] },
      ]);
      return respond({ ok: true, calendarDate });
    }

    return respond({ error: 'Action tidak dikenal' }, 422);
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}