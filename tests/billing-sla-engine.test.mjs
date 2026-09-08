import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  addBusinessDaysUtc, calendarYearsNeeded, isValidSlaDate, normalizeSlaDate, resolveSlaTrigger, validateSlaPolicyInput,
} from '../functions/api/billing-sla-core.js';

const migration = await readFile(new URL('../migrations/0023_billing_sla_trigger_engine.sql', import.meta.url), 'utf8');
const hardeningMigration = await readFile(new URL('../migrations/0024_billing_sla_hardening.sql', import.meta.url), 'utf8');
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

test('SLA dates reject impossible calendar values instead of normalizing them silently', () => {
  assert.equal(isValidSlaDate('2026-02-28'), true);
  assert.equal(isValidSlaDate('2026-02-29'), false);
  assert.equal(isValidSlaDate('2026-02-31'), false);
  assert.equal(normalizeSlaDate('2026-13-01'), null);
  assert.throws(() => addBusinessDaysUtc('2026-02-31', 1), /Invalid business-day start date/);
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

test('calendar coverage is fail-closed only when the calculation actually reaches an unavailable year', () => {
  assert.deepEqual(calendarYearsNeeded('2026-11-20', 60), [2026, 2027]);
  assert.match(service, /calendarIncomplete/);
  assert.match(service, /missingYears/);
  assert.match(service, /while \(remaining > 0\)/);
  assert.match(service, /version\?\.status !== 'OFFICIAL'/);
  assert.match(service, /expected_national_holiday_count/);
  assert.match(service, /nationalHolidayCount !== Number\(version\.expected_national_holiday_count\)/);
});

test('0023 plus forward-only 0024 seed and enforce official-calendar and active-policy invariants', () => {
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
    INSERT INTO organizations(id) VALUES('ORG');
    INSERT INTO clients(id,org_id) VALUES('CLIENT','ORG');
    INSERT INTO projects(id,org_id,client_id) VALUES('PROJECT','ORG','CLIENT');
  `);
  db.exec(migration);
  db.exec(hardeningMigration);
  const count = db.prepare("SELECT COUNT(*) AS count FROM business_calendar_days WHERE country_code='ID' AND calendar_year=2026 AND day_type='NATIONAL_HOLIDAY'").get();
  const collective = db.prepare("SELECT COUNT(*) AS count FROM business_calendar_days WHERE country_code='ID' AND calendar_year=2026 AND day_type='COLLECTIVE_LEAVE'").get();
  const calendar = db.prepare("SELECT status,expected_national_holiday_count FROM business_calendar_years WHERE country_code='ID' AND year=2026").get();
  assert.equal(Number(count.count), 17);
  assert.equal(Number(collective.count), 0);
  assert.equal(calendar.status, 'OFFICIAL');
  assert.equal(Number(calendar.expected_national_holiday_count), 17);

  const insertPolicy = db.prepare(`INSERT INTO billing_sla_policies
    (id,org_id,client_id,project_id,terms_business_days,required_triggers,calendar_mode,status,effective_from,created_by)
    VALUES(?,?,?,?,30,'["INVOICE_ISSUED"]','WEEKDAYS_ONLY','ACTIVE','2026-01-01','ops')`);
  insertPolicy.run('SLA-A','ORG','CLIENT',null);
  assert.throws(() => insertPolicy.run('SLA-B','ORG','CLIENT',null), /UNIQUE constraint failed/);
  insertPolicy.run('SLA-P1','ORG','CLIENT','PROJECT');
  assert.throws(() => insertPolicy.run('SLA-P2','ORG','CLIENT','PROJECT'), /UNIQUE constraint failed/);
  assert.throws(() => db.prepare(`INSERT INTO billing_sla_policies
    (id,org_id,client_id,terms_business_days,required_triggers,calendar_mode,status,effective_from,created_by)
    VALUES('SLA-BAD','ORG','CLIENT',30,'{}','WEEKDAYS_ONLY','INACTIVE','2026-01-01','ops')`).run(), /JSON array/);
  assert.throws(() => db.prepare(`UPDATE business_calendar_days SET is_business_day=1
    WHERE country_code='ID' AND calendar_date='2026-08-17'`).run(), /NATIONAL_HOLIDAY cannot be a business day/);
  db.close();
});

test('PAYROLL_PAID uses actual payment provenance after matched reconciliation', () => {
  assert.match(service, /status='MATCHED'/);
  assert.match(service, /MAX\(date\(transaction_date\)\) AS paid_on/);
  assert.match(service, /payment_gateway_transactions/);
  assert.match(service, /status='SUCCEEDED'/);
  assert.match(service, /MAX\(occurred_on\) AS occurred_on/);
});

test('legacy invoice issue path remains safe before migration 0023 is installed', () => {
  const block = billing.match(/async function materializeLegacyAr[\s\S]*?export async function onRequest/)?.[0] || '';
  assert.ok(block);
  assert.doesNotMatch(block, /sla_status/);
  assert.match(block, /UPDATE invoices SET due_date=/);
  assert.match(billing, /billingSlaSchemaAvailable/);
});

test('SLA schema readiness checks invoice columns, not only table names', () => {
  assert.match(service, /pragma_table_info\('invoices'\)/);
  assert.match(service, /sla_policy_id/);
  assert.match(service, /sla_trigger_basis/);
});

test('manual evidence decisions are maker-checker, retry-safe, and concurrency guarded', () => {
  assert.match(endpoint, /Maker tidak boleh memverifikasi evidence sendiri/);
  assert.match(endpoint, /idempotentReplay: true/);
  assert.match(endpoint, /SLA_EVIDENCE_CONCURRENT_DECISION/);
  assert.match(endpoint, /NOT EXISTS\(SELECT 1 FROM audit_logs/);
  assert.match(service, /status='VERIFIED'/);
  assert.match(billing, /slaPending/);
  assert.match(billing, /materializeInvoiceSla/);
});

test('policy writes are idempotent and protected against concurrent active versions', () => {
  assert.match(endpoint, /samePolicy\(current, checked\)/);
  assert.match(endpoint, /SLA_POLICY_CONCURRENT_UPDATE/);
  assert.match(hardeningMigration, /idx_one_active_client_sla_policy/);
  assert.match(hardeningMigration, /idx_one_active_project_sla_policy/);
});

test('official calendar promotion requires an auditable complete holiday set', () => {
  assert.match(endpoint, /expectedNationalHolidayCount/);
  assert.match(endpoint, /BUSINESS_CALENDAR_INCOMPLETE/);
  assert.match(endpoint, /BUSINESS_CALENDAR_YEAR_UPDATED/);
  assert.match(endpoint, /BUSINESS_CALENDAR_DAY_UPDATED/);
  assert.match(endpoint, /National holiday tidak boleh ditandai sebagai business day/);
  assert.match(hardeningMigration, /OFFICIAL business calendar is incomplete/);
});

test('AR materialization heals a concurrent duplicate instead of returning a 500', () => {
  assert.match(service, /UNIQUE constraint failed: ar_monitor\.invoice_id/);
  assert.match(service, /concurrentAr/);
  assert.match(service, /idempotentReplay: true/);
});