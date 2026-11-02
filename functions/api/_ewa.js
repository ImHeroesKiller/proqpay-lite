import { d1All, d1Batch } from './_d1.js';

export const DEFAULT_EWA_POLICY = Object.freeze({
  enabled: 0,
  fee_rate: 0.03,
  min_fee: 50000,
  min_fee_amount: 1750000,
  max_percent: 0.3,
  max_tenor_months: 1,
  min_days_worked: 10,
  min_tenure_months: 1,
  min_tenure_days: 0,
});

const STAGE_INDEX = {
  DRAFT: 1, EXCEPTION_FOUND: 1, EXCEPTION_REVIEW: 1, CLIENT_ACTION_REQUIRED: 1,
  REVISION_REQUIRED: 1, REJECTED: 1, CANCELLED: 1,
  SUBMITTED: 2, INGESTING: 2, AI_VALIDATING: 2, CLIENT_RESUBMITTED: 2,
  VALIDATED: 2, STANDARDIZED: 2, PROCESSOR_REVIEW: 2,
  CONTROLLER_REVIEW: 3, DATA_APPROVED: 3, PAYROLL_FINALIZED: 3,
  PAYMENT_INSTRUCTION_READY: 4, PAYMENT_APPROVAL_PENDING: 4, APPROVED_FOR_PAYMENT: 4,
  DISBURSEMENT_PROCESSING: 4, PROOF_UPLOADED: 4,
  RECONCILIATION: 4, PAYMENT_EXCEPTION: 4, COMPLETED: 5,
};

export function payrollStageIndex(state, piStatus, recStatus) {
  const reconciliationStatus = String(recStatus || '').trim().toUpperCase();
  const paymentStatus = String(piStatus || '').trim().toUpperCase();
  if (['MATCHED', 'COMPLETED', 'RECONCILED'].includes(reconciliationStatus)) return 5;
  if (['PAID', 'COMPLETED', 'RECONCILED'].includes(paymentStatus)) return 5;
  return STAGE_INDEX[String(state || '').toUpperCase()] || 1;
}

function isBusinessDay(date) {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function businessDaysInclusive(start, end) {
  if (start.getTime() > end.getTime()) return 0;
  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    if (isBusinessDay(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function earnedDaysInPeriod(now = new Date(), joinDate = '') {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  const today = new Date(Date.UTC(year, month, now.getUTCDate()));
  const parsedJoin = parseDateOnly(joinDate);
  const join = parsedJoin ? new Date(Date.UTC(parsedJoin.y, parsedJoin.m, parsedJoin.d)) : null;
  const effectiveStart = join && join.getTime() > monthStart.getTime() ? join : monthStart;
  const cappedToday = today.getTime() > monthEnd.getTime() ? monthEnd : today;
  const daysInMonth = businessDaysInclusive(monthStart, monthEnd);
  const daysWorked = businessDaysInclusive(effectiveStart, cappedToday);
  return { daysWorked, daysInMonth, period: `${year}-${String(month + 1).padStart(2, '0')}` };
}

export function parseDateOnly(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

export function tenureDaysFromJoin(joinDate, now = new Date()) {
  const start = parseDateOnly(joinDate);
  if (!start) return 0;
  const from = Date.UTC(start.y, start.m, start.d);
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((to - from) / 86400000));
}

export function tenureMonthsFromJoin(joinDate, now = new Date()) {
  const start = parseDateOnly(joinDate);
  if (!start) return 0;
  let months = (now.getUTCFullYear() - start.y) * 12 + (now.getUTCMonth() - start.m);
  if (now.getUTCDate() < start.d) months -= 1;
  return Math.max(0, months);
}

function joinLabel(joinDate) {
  const start = parseDateOnly(joinDate);
  if (!start) return '';
  return new Date(Date.UTC(start.y, start.m, start.d)).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function ewaFee(amount, policy = DEFAULT_EWA_POLICY) {
  const value = Math.max(0, Math.round(Number(amount) || 0));
  const pct = Math.round(value * Number(policy.fee_rate || 0));
  const min = value <= Number(policy.min_fee_amount || 0) ? Number(policy.min_fee || 0) : 0;
  return Math.max(pct, min);
}

export function ewaPlafond({ net, daysWorked, daysInMonth, maxPercent }) {
  const dim = Math.max(1, Number(daysInMonth) || 1);
  const earned = Number(net || 0) * (Math.max(0, Number(daysWorked) || 0) / dim) * Number(maxPercent || 0);
  return Math.max(0, Math.floor(earned / 10000) * 10000);
}

export function ewaEligibility({
  policy = DEFAULT_EWA_POLICY,
  daysWorked,
  tenureMonths,
  tenureDays,
  joinDate,
  plafond,
  openRequest,
  active = true,
}) {
  if (!active) return { eligible: false, reason: 'Karyawan tidak aktif' };
  if (!Number(policy.enabled)) return { eligible: false, reason: 'Advance salary belum diaktifkan' };
  if (openRequest) return { eligible: false, reason: 'Masih ada pengajuan yang berjalan' };
  const days = Number.isFinite(Number(tenureDays)) ? Number(tenureDays) : 0;
  const months = Number(tenureMonths) || 0;
  const needDays = Number(policy.min_tenure_days || 0);
  const needMonths = Number(policy.min_tenure_months || 0);
  const joined = joinLabel(joinDate);
  const joinedBit = joined ? ` (bergabung ${joined})` : ' (tanggal bergabung belum ada di kontrak)';
  if (needDays > 0 && days < needDays) return { eligible: false, reason: `Masa kerja ${days} hari${joinedBit}. Minimal ${needDays} hari` };
  if (needMonths > 0 && months < needMonths) return { eligible: false, reason: `Masa kerja ${days} hari${joinedBit}. Minimal ${needMonths} bulan` };
  if (Number(daysWorked) < Number(policy.min_days_worked || 0)) return { eligible: false, reason: `Minimal ${policy.min_days_worked} hari kerja di periode gaji ini` };
  if (Number(plafond) < 100000) return { eligible: false, reason: 'Plafond belum mencukupi' };
  return { eligible: true, reason: '' };
}

export function policyToRules(policy = DEFAULT_EWA_POLICY) {
  return {
    feeRate: Number(policy.fee_rate), minFee: Number(policy.min_fee), minFeeAmount: Number(policy.min_fee_amount),
    maxTenorMonths: Number(policy.max_tenor_months), maxPercent: Number(policy.max_percent),
    minDaysWorked: Number(policy.min_days_worked), minTenureMonths: Number(policy.min_tenure_months),
    minTenureDays: Number(policy.min_tenure_days || 0), enabled: Boolean(Number(policy.enabled)),
  };
}

function parseComponents(raw) {
  try { const parsed = JSON.parse(raw || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch { return {}; }
}
function hasEwaComponent(components) {
  const names = Array.isArray(components) ? components.map(item => item?.code || item?.name || item?.label) : Object.keys(components || {});
  return names.some(name => /^(ewaRepayment|ewaFee)$/i.test(String(name || '')));
}
function attachEwa(components, amount, fee) {
  if (Array.isArray(components)) return [...components, { name: 'ewaRepayment', amount: -Math.abs(amount) }, { name: 'ewaFee', amount: -Math.abs(fee) }];
  return { ...components, ewaRepayment: -Math.abs(amount), ewaFee: -Math.abs(fee) };
}

/** Claim and apply a loan once; DB triggers keep allocation, line and audit atomic. */
export async function applyEwaRepayments(database, submissionId) {
  if (!database || !submissionId) return { applied: 0 };
  const rows = await d1All(database, `SELECT r.*,l.id AS line_id,l.deduction_amount,l.net_amount,l.components
    FROM ewa_requests r JOIN payroll_submissions s ON s.id=? AND s.org_id=r.org_id AND s.client_id=r.client_id
    JOIN payroll_run_lines l ON l.submission_id=s.id AND l.employee_id=r.employee_id AND l.included=1
    WHERE r.status IN ('DISBURSED','REPAYING') AND r.period<=s.period
      AND (r.payroll_submission_id IS NULL OR r.payroll_submission_id=s.id)
      AND NOT EXISTS(SELECT 1 FROM ewa_repayment_allocations a WHERE a.ewa_request_id=r.id)`, [submissionId]);
  const operations = [];
  for (const row of rows) {
    // Historical markers are not collection evidence. Never silently adopt them.
    const components = parseComponents(row.components);
    if (row.status !== 'DISBURSED' || row.payroll_submission_id || hasEwaComponent(components)) {
      throw new Error(`EWA_REPAYMENT_REVIEW_REQUIRED:${row.id}`);
    }
    const principal = Number(row.amount), fee = Number(row.fee), repayment = Number(row.repayment);
    if (![principal, fee, repayment].every(Number.isSafeInteger) || principal <= 0 || fee < 0 || repayment !== principal + fee) {
      throw new Error(`EWA_REPAYMENT_INVALID:${row.id}`);
    }
    const net = Number(row.net_amount);
    if (net - repayment <= 0) throw new Error(`EWA_REPAYMENT_EXCEEDS_NET:${row.id}`);
    operations.push({statement: `INSERT INTO ewa_repayment_allocations
      (ewa_request_id,org_id,client_id,submission_id,employee_id,line_id,principal,fee,total,
       base_net,base_deduction,base_components,applied_net,applied_deduction,applied_components)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(
        SELECT 1 FROM ewa_requests WHERE id=? AND status='DISBURSED' AND payroll_submission_id IS NULL)
        AND NOT EXISTS(SELECT 1 FROM ewa_repayment_allocations WHERE ewa_request_id=?)`,
      bindings: [row.id,row.org_id,row.client_id,submissionId,row.employee_id,row.line_id,principal,fee,repayment,
        net,Number(row.deduction_amount),row.components ?? '{}',net-repayment,Number(row.deduction_amount)+repayment,
        JSON.stringify(attachEwa(components,principal,fee)),row.id,row.id]});
  }
  // D1 meta.changes includes trigger writes; SQLite changes() is the direct claim count.
  const results = await d1Batch(database, operations.flatMap(operation => [operation,{statement:'SELECT changes() AS applied'}]));
  return { applied: results.reduce((sum, r) => sum + Number(r.results?.[0]?.applied || 0), 0) };
}

/** Collect only allocations backed by this employee's paid immutable PI line. */
export async function markEwaRepaid(database, submissionId) {
  if (!database || !submissionId) return { collected: 0 };
  const results = await d1Batch(database, [{statement: `UPDATE ewa_repayment_allocations
    SET payment_instruction_id=(SELECT e.payment_instruction_id FROM ewa_repayment_collection_evidence e
      WHERE e.ewa_request_id=ewa_repayment_allocations.ewa_request_id ORDER BY e.payment_instruction_id LIMIT 1),
      collected_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE submission_id=? AND collected_at IS NULL
      AND EXISTS(SELECT 1 FROM ewa_repayment_collection_evidence e WHERE e.ewa_request_id=ewa_repayment_allocations.ewa_request_id)`,bindings:[submissionId]},
    {statement:'SELECT changes() AS collected'}]);
  return { collected: Number(results[1]?.results?.[0]?.collected || 0) };
}
