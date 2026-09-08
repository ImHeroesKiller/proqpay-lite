import { d1All, d1Batch, d1First } from './_d1.js';
import {
  addBusinessDaysUtc, calendarYearsNeeded, normalizeRequiredTriggers, resolveSlaTrigger,
} from './billing-sla-core.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export async function billingSlaSchemaAvailable(database) {
  const row = await d1First(database, `SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type='table' AND name IN ('billing_sla_policies','billing_sla_evidence','business_calendar_years','business_calendar_days')`);
  return Number(row?.count || 0) === 4;
}

export async function selectBillingSlaPolicy(database, organizationId, clientId, projectId, at = new Date().toISOString()) {
  return d1First(database, `SELECT * FROM billing_sla_policies
    WHERE org_id=? AND client_id=? AND status='ACTIVE'
      AND (project_id=? OR project_id IS NULL)
      AND datetime(effective_from)<=datetime(?)
      AND (effective_until IS NULL OR datetime(effective_until)>datetime(?))
    ORDER BY CASE WHEN project_id=? THEN 0 ELSE 1 END, datetime(effective_from) DESC
    LIMIT 1`, [organizationId, clientId, projectId || null, at, at, projectId || null]);
}

async function policyForInvoice(database, invoice, organizationId) {
  if (invoice.sla_policy_id) {
    return d1First(database, 'SELECT * FROM billing_sla_policies WHERE id=? AND org_id=? LIMIT 1',
      [invoice.sla_policy_id, organizationId]);
  }
  return selectBillingSlaPolicy(database, organizationId, invoice.client_id, invoice.project_id, invoice.issued_at || new Date().toISOString());
}

async function slaFacts(database, invoice) {
  const reconciliation = await d1First(database, `SELECT created_at FROM reconciliations
    WHERE payment_instruction_id=? AND status='MATCHED' LIMIT 1`, [invoice.payment_instruction_id]);
  const evidence = await d1All(database, `SELECT trigger_type,occurred_on FROM billing_sla_evidence
    WHERE invoice_id=? AND status='VERIFIED' ORDER BY datetime(verified_at) DESC, datetime(created_at) DESC`, [invoice.id]);
  const facts = {
    PAYROLL_PAID: reconciliation?.created_at || null,
    INVOICE_ISSUED: invoice.issued_at || null,
  };
  for (const row of evidence) {
    if (!facts[row.trigger_type]) facts[row.trigger_type] = row.occurred_on;
  }
  return facts;
}

async function officialCalendar(database, triggerDate, termsBusinessDays) {
  const years = calendarYearsNeeded(triggerDate, termsBusinessDays);
  if (!years.length) return { complete: false, missingYears: [], holidays: new Set() };
  const placeholders = years.map(() => '?').join(',');
  const versions = await d1All(database, `SELECT year,status FROM business_calendar_years
    WHERE country_code='ID' AND year IN (${placeholders})`, years);
  const official = new Set(versions.filter((row) => row.status === 'OFFICIAL').map((row) => Number(row.year)));
  const missingYears = years.filter((year) => !official.has(year));
  if (missingYears.length) return { complete: false, missingYears, holidays: new Set() };
  const days = await d1All(database, `SELECT calendar_date FROM business_calendar_days
    WHERE country_code='ID' AND calendar_year IN (${placeholders}) AND is_business_day=0`, years);
  return { complete: true, missingYears: [], holidays: new Set(days.map((row) => String(row.calendar_date))) };
}

export async function evaluateInvoiceSla(database, organizationId, invoice) {
  const available = await billingSlaSchemaAvailable(database);
  if (!available) return { configured: false, schemaMissing: true, ready: true, legacy: true };
  const policy = await policyForInvoice(database, invoice, organizationId);
  if (!policy) return { configured: false, ready: true, legacy: true };
  const requiredTriggers = normalizeRequiredTriggers(JSON.parse(policy.required_triggers || '[]'));
  if (!requiredTriggers) return { configured: true, ready: false, invalidPolicy: true, policy };
  const facts = await slaFacts(database, invoice);
  const trigger = resolveSlaTrigger(requiredTriggers, facts);
  if (!trigger.ready) {
    return { configured: true, ready: false, policy, requiredTriggers, missing: trigger.missing, basis: trigger.basis };
  }
  let holidays = new Set();
  if (policy.calendar_mode === 'ID_OFFICIAL') {
    const calendar = await officialCalendar(database, trigger.triggerDate, Number(policy.terms_business_days));
    if (!calendar.complete) {
      return { configured: true, ready: false, policy, requiredTriggers, basis: trigger.basis,
        triggerDate: trigger.triggerDate, calendarIncomplete: true, missingYears: calendar.missingYears };
    }
    holidays = calendar.holidays;
  }
  const dueDate = addBusinessDaysUtc(trigger.triggerDate, Number(policy.terms_business_days), holidays).toISOString().slice(0, 10);
  return { configured: true, ready: true, policy, requiredTriggers, basis: trigger.basis,
    triggerDate: trigger.triggerDate, dueDate };
}

export async function materializeInvoiceSla(database, organizationId, invoiceId) {
  const invoice = await d1First(database, `SELECT i.*,c.payment_terms_days FROM invoices i
    JOIN clients c ON c.id=i.client_id WHERE i.id=? AND i.org_id=? LIMIT 1`, [invoiceId, organizationId]);
  if (!invoice) return { status: 404, error: 'Invoice tidak ditemukan' };
  if (!['ISSUED','PARTIALLY_PAID','PAID'].includes(invoice.status)) {
    return { status: 409, error: 'Invoice belum diterbitkan; SLA belum dapat diaktifkan' };
  }
  const existingAr = await d1First(database, 'SELECT * FROM ar_monitor WHERE invoice_id=? AND org_id=? LIMIT 1', [invoice.id, organizationId]);
  if (existingAr && invoice.sla_status === 'ACTIVE' && invoice.due_date) {
    return { status: 200, ok: true, invoice, ar: existingAr, idempotentReplay: true };
  }
  const evaluation = await evaluateInvoiceSla(database, organizationId, invoice);
  if (evaluation.legacy) return { status: 200, ok: true, legacy: true, evaluation };
  if (evaluation.invalidPolicy) return { status: 409, error: 'Konfigurasi SLA tidak valid', code: 'SLA_POLICY_INVALID' };
  if (!evaluation.ready) {
    const slaStatus = evaluation.calendarIncomplete ? 'CALENDAR_INCOMPLETE' : 'WAITING_EVIDENCE';
    await d1Batch(database, [{ statement: `UPDATE invoices SET sla_policy_id=?,sla_status=?,sla_triggered_at=NULL,
      sla_trigger_basis=?,due_date=NULL,updated_at=${NOW} WHERE id=? AND org_id=?`,
      bindings: [evaluation.policy.id, slaStatus, JSON.stringify(evaluation.basis || {}), invoice.id, organizationId] }]);
    return { status: 200, ok: true, pending: true, slaStatus, evaluation };
  }
  const arId = existingAr?.id || `AR-${crypto.randomUUID()}`;
  const operations = [
    { statement: `UPDATE invoices SET sla_policy_id=?,sla_status='ACTIVE',sla_triggered_at=?,sla_trigger_basis=?,
      due_date=?,updated_at=${NOW} WHERE id=? AND org_id=?`,
      bindings: [evaluation.policy.id, evaluation.triggerDate, JSON.stringify(evaluation.basis), evaluation.dueDate, invoice.id, organizationId] },
  ];
  if (!existingAr) operations.push({ statement: `INSERT INTO ar_monitor
    (id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,days_overdue,type,notes,updated_at)
    VALUES(?,?,?,?,?,?,?,0,?,'OUTSTANDING',?,0,'INVOICE','AR diaktifkan setelah SLA trigger terverifikasi',${NOW})`,
    bindings: [arId, organizationId, invoice.client_id, invoice.project_id, invoice.company, invoice.id,
      invoice.total_amount, invoice.total_amount, evaluation.dueDate] });
  else operations.push({ statement: `UPDATE ar_monitor SET due_date=?,updated_at=${NOW} WHERE id=? AND org_id=?`,
    bindings: [evaluation.dueDate, existingAr.id, organizationId] });
  await d1Batch(database, operations);
  const [updatedInvoice, ar] = await Promise.all([
    d1First(database, 'SELECT * FROM invoices WHERE id=?', [invoice.id]),
    d1First(database, 'SELECT * FROM ar_monitor WHERE invoice_id=? AND org_id=? LIMIT 1', [invoice.id, organizationId]),
  ]);
  return { status: 200, ok: true, invoice: updatedInvoice, ar, evaluation };
}
