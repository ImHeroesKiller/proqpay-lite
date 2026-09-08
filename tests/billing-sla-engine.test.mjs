import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  addBusinessDaysUtc, calendarYearsNeeded, resolveSlaTrigger, validateSlaPolicyInput,
} from '../functions/api/billing-sla-core.js';

const migration = await readFile(new URL('../migrations/0023_billing_sla_trigger_engine.sql', import.meta.url), 'utf8');
const endpoint = await readFile(new URL('../functions/api/billing-sla.js', import.meta.url), 'utf8');
const service = await readFile(new URL('../functions/api/billing-sla-service.js', import.meta.url), 'utf8');
const billing = await readFile(new URL('../functions/api/billing.js', import.meta.url), 'utf8');

test('SLA policy accepts business terms and controlled trigger combinations', () => {
  const checked = validateSlaPolicyInput({
    termsBusinessDays: 30,
    requiredTriggers: ['PAYROLL_PAID','INVOICE_DOC_COMPLETE','BAST_SIGNED'],
    calendarMode: 'ID_OFFICIAL',
  });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.requiredTriggers, ['PAYROLL_PAID','INVOICE_DOC_COMPLETE','BAST_SIGNED']);
  assert.equal(validateSlaPolicyInput({ termsBusinessDays: 0, requiredTriggers: ['UNKNOWN'], calendarMode: 'ID_OFFICIAL' }).ok, false);
});

test('SLA starts only when every configured prerequisite exists and uses the latest evidence date', () => {
  const pending = resolveSlaTrigger(['PAYROLL_PAID','INVOICE_DOC_COMPLETE','BAST_SIGNED'], {
    PAYROLL_PAID: '2026-08-03', INVOICE_DOC_COMPLETE: '2026-08-05',
  });
  assert.equal(pending.ready, false);
  assert.deepEqual(pending.missing, ['BAST_SIGNED']);

  const ready = resolveSlaTrigger(['PAYROLL_PAID','INVOICE_DOC_COMPLETE','BAST_SIGNED'], {
    PAYROLL_PAID: '2026-08-03', INVOICE_DOC_COMPLETE: '2026-08-05', BAST_SIGNED: '2026-08-07',
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.triggerDate, '2026-08-07');
});

test('official holiday can move a weekday SLA due date', () => {
  const holidays = new Set(['2026-08-17']);
  const due = addBusinessDaysUtc('2026-08-14', 1, holidays);
  assert.equal(due.toISOString().slice(0, 10), '2026-08-18');
});

test('calendar coverage is fail-closed when a long SLA can cross into another year', () => {
  assert.deepEqual(calendarYearsNeeded('2026-11-20', 60), [2026, 2027]);
  assert.match(service, /calendarIncomplete/);
  assert.match(service, /missingYears/);
});

test('migration is D1-safe, seeds 17 official 2026 holidays, and does not auto-apply collective leave', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE organizations(id TEXT PRIMARY KEY);
    CREATE TABLE clients(id TEXT PRIMARY KEY,org_id TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,org_id TEXT,client_id TEXT);
    CREATE TABLE payment_instructions(id TEXT PRIMARY KEY);
    CREATE TABLE invoices(id TEXT PRIMARY KEY,org_id TEXT,client_id TEXT,project_id TEXT,payment_instruction_id TEXT,status TEXT,due_date TEXT,updated_at TEXT);
    CREATE TABLE audit_logs(id TEXT PRIMARY KEY,org_id TEXT,username TEXT,role TEXT,action TEXT,detail TEXT,entity TEXT,entity_id TEXT);
    CREATE TABLE ar_monitor(id TEXT PRIMARY KEY,org_id TEXT,client_id TEXT,project_id TEXT,company TEXT,invoice_id TEXT,amount INTEGER,paid_amount INTEGER,balance INTEGER,status TEXT,due_date TEXT,days_overdue INTEGER,type TEXT,notes TEXT,updated_at TEXT);
    CREATE TABLE reconciliations(id TEXT PRIMARY KEY,payment_instruction_id TEXT,status TEXT,created_at TEXT);
  `);
  db.exec(migration);
  const count = db.prepare("SELECT COUNT(*) AS count FROM business_calendar_days WHERE country_code='ID' AND calendar_year=2026 AND day_type='NATIONAL_HOLIDAY'").get();
  const collective = db.prepare("SELECT COUNT(*) AS count FROM business_calendar_days WHERE country_code='ID' AND calendar_year=2026 AND day_type='COLLECTIVE_LEAVE'").get();
  assert.equal(Number(count.count), 17);
  assert.equal(Number(collective.count), 0);
  const invoiceColumns = db.prepare("PRAGMA table_info(invoices)").all().map((row) => row.name);
  assert.ok(invoiceColumns.includes('sla_policy_id'));
  assert.ok(invoiceColumns.includes('sla_status'));
  db.close();
});

test('manual evidence is maker-checker and cannot directly mutate financial due dates', () => {
  assert.match(endpoint, /Maker tidak boleh memverifikasi evidence sendiri/);
  assert.match(endpoint, /status='RECORDED'/);
  assert.match(endpoint, /BILLING_SLA_EVIDENCE_VERIFIED/);
  assert.match(service, /status='VERIFIED'/);
  assert.match(billing, /slaPending/);
  assert.match(billing, /materializeInvoiceSla/);
});
