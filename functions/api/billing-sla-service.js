import { d1All, d1Batch, d1First } from './_d1.js';
import {
  addBusinessDaysUtc, normalizeRequiredTriggers, resolveSlaTrigger,
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

async function matchedPaymentDate(database, paymentInstructionId) {
  const reconciliation = await d1First(database, `SELECT created_at FROM reconciliations
    WHERE payment_instruction_id=? AND status='MATCHED' LIMIT 1`, [paymentInstructionId]);
  if (!reconciliation) return null;

  const [proof, gateway] = await Promise.all([
    d1First(database, `SELECT MAX(date(transaction_date)) AS paid_on FROM payment_proofs
      WHERE payment_instruction_id=?`, [paymentInstructionId]),
    d1First(database, `SELECT MAX(date(paid_at)) AS paid_on FROM payment_gateway_transactions
      WHERE payment_instruction_id=? AND status='SUCCEEDED' AND paid_at IS NOT NULL`, [paymentInstructionId]),
  ]);
  const actualDates = [proof?.paid_on, gateway?.paid_on].filter(Boolean).map(String).sort();
  if (actualDates.length) return actualDates.at(-1);

  // Legacy matched reconciliations may predate canonical proof/gateway timestamps.
  // Keep them usable, but only after MATCHED proves the payment was reconciled.
  return String(reconciliation.created_at || '').slice(0, 10) || null;
}

async function slaFacts(database, invoice) {
  const evidence = await d1All(database, `SELECT trigger_type,MAX(occurred_on) AS occurred_on
    FROM billing_sla_evidence WHERE invoice_id=? AND status='VERIFIED'
    GROUP BY trigger_type`, [invoice.id]);
  const facts = {
    PAYROLL_PAID: await matchedPaymentDate(database, invoice.payment_instruction_id),
    INVOICE_ISSUED: invoice.issued_at || null,
  };
  for (const row of evidence) facts[row.trigger_type] = row.occurred_on;
  return facts;
}

async function officialDueDate(database, triggerDate, termsBusinessDays) {
  const start = String(triggerDate || '').slice(0, 10);
  const date = new Date(`${start}T00:00:00.000Z`);
  const terms = Number(termsBusinessDays);
  if (Number.isNaN(date.getTime()) || !Number.isSafeInteger(terms) || terms < 1 || terms > 365) {
    return { complete: false, invalid: true, missingYears: [] };
  }

  const calendars = new Map();
  async function loadYear(year) {
    if (calendars.has(year)) return calendars.get(year);
    const version = await d1First(database, `SELECT status FROM business_calendar_years
      WHERE country_code='ID' AND year=? LIMIT 1`, [year]);
    if (version?.status !== 'OFFICIAL') return null;
    const rows = await d1All(database, `SELECT calendar_date FROM business_calendar_days
      WHERE country_code='ID' AND calendar_year=? AND is_business_day=0`, [year]);
    const holidays = new Set(rows.map((row) => String(row.calendar_date)));
    calendars.set(year, holidays);
    return holidays;
  }

  let remaining = terms;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const year = date.getUTCFullYear();
    const holidays = await loadYear(year);
    if (!holidays) return { complete: false, missingYears: [year] };
    const weekday = date.getUTCDay();
    const key = date.toISOString().slice(0, 10);
    if (weekday !== 0 && weekday !== 6 && !holidays.has(key)) remaining -= 1;
  }
  return { complete: true, dueDate: date.toISOString().slice(0, 10), missingYears: [] };
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

  let dueDate;
  if (policy.calendar_mode === 'ID_OFFICIAL') {
    const calendar = await officialDueDate(database, trigger.triggerDate, Number(policy.terms_business_days));
    if (!calendar.complete) {
      return { configured: true, ready: false, policy, requiredTriggers, basis: trigger.basis,
        triggerDate: trigger.triggerDate, calendarIncomplete: true, missingYears: calendar.missingYears,
        invalidCalendarInput: Boolean(calendar.invalid) };
    }
    dueDate = calendar.dueDate;
  } else {
    dueDate = addBusinessDaysUtc(trigger.triggerDate, Number(policy.terms_business_days)).toISOString().slice(0, 10);
  }
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
