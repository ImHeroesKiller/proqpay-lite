import { d1All, d1First, d1Run } from './_d1.js';

export const DEFAULT_EWA_POLICY = Object.freeze({
  enabled: 1,
  fee_rate: 0.03,
  min_fee: 50000,
  min_fee_amount: 1750000,
  max_percent: 0.3,
  max_tenor_months: 1,
  min_days_worked: 10,
  min_tenure_months: 1,
});

const STAGE_INDEX = {
  DRAFT: 1, EXCEPTION_FOUND: 1, EXCEPTION_REVIEW: 1, CLIENT_ACTION_REQUIRED: 1,
  REVISION_REQUIRED: 1, REJECTED: 1, CANCELLED: 1,
  SUBMITTED: 2, INGESTING: 2, AI_VALIDATING: 2, CLIENT_RESUBMITTED: 2,
  VALIDATED: 2, STANDARDIZED: 2, PROCESSOR_REVIEW: 2,
  CONTROLLER_REVIEW: 3, DATA_APPROVED: 3, PAYROLL_FINALIZED: 3,
  PAYMENT_INSTRUCTION_READY: 4, PAYMENT_APPROVAL_PENDING: 4, APPROVED_FOR_PAYMENT: 4,
  DISBURSEMENT_PROCESSING: 4, PROOF_UPLOADED: 4,
  RECONCILIATION: 5, PAYMENT_EXCEPTION: 5, COMPLETED: 5,
};

export function payrollStageIndex(state, piStatus, recStatus) {
  if (recStatus && /MATCH|COMPLETE/i.test(String(recStatus))) return 5;
  if (piStatus && /PAID|COMPLETED|RECONCILED/i.test(String(piStatus))) return 5;
  return STAGE_INDEX[String(state || '').toUpperCase()] || 1;
}

export function earnedDaysInPeriod(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysWorked = Math.min(Math.max(now.getDate(), 1), daysInMonth);
  return { daysWorked, daysInMonth, period: `${year}-${String(month + 1).padStart(2, '0')}` };
}

export function tenureMonthsFromJoin(joinDate, now = new Date()) {
  if (!joinDate) return 0;
  const start = new Date(joinDate);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()));
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
  plafond,
  openRequest,
  paid,
  active = true,
}) {
  if (!active) return { eligible: false, reason: 'Karyawan tidak aktif' };
  if (!Number(policy.enabled)) return { eligible: false, reason: 'Advance salary belum diaktifkan' };
  if (paid) return { eligible: false, reason: 'Payroll periode ini sudah dibayar' };
  if (openRequest) return { eligible: false, reason: 'Masih ada pengajuan yang berjalan' };
  if (Number(tenureMonths) < Number(policy.min_tenure_months || 0)) {
    return { eligible: false, reason: `Masa kerja minimal ${policy.min_tenure_months} bulan` };
  }
  if (Number(daysWorked) < Number(policy.min_days_worked || 0)) {
    return { eligible: false, reason: `Minimal ${policy.min_days_worked} hari berjalan di periode ini` };
  }
  if (Number(plafond) < 100000) return { eligible: false, reason: 'Plafond belum mencukupi' };
  return { eligible: true, reason: '' };
}

export function policyToRules(policy = DEFAULT_EWA_POLICY) {
  return {
    feeRate: Number(policy.fee_rate),
    minFee: Number(policy.min_fee),
    minFeeAmount: Number(policy.min_fee_amount),
    maxTenorMonths: Number(policy.max_tenor_months),
    maxPercent: Number(policy.max_percent),
    minDaysWorked: Number(policy.min_days_worked),
    minTenureMonths: Number(policy.min_tenure_months),
    enabled: Boolean(Number(policy.enabled)),
  };
}

function parseComponents(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function hasEwaComponent(components) {
  if (Array.isArray(components)) {
    return components.some((item) => /ewa/i.test(String(item?.name || item?.label || item?.code || '')));
  }
  return Object.keys(components || {}).some((key) => /ewa/i.test(key));
}

function attachEwa(components, amount, fee) {
  if (Array.isArray(components)) {
    return [...components, { name: 'ewaRepayment', amount: -Math.abs(amount) }, { name: 'ewaFee', amount: -Math.abs(fee) }];
  }
  return { ...components, ewaRepayment: -Math.abs(amount), ewaFee: -Math.abs(fee) };
}

/** Deduct disbursed EWA from pay-run snapshot. Idempotent. Does not create PI or change workflow. */
export async function applyEwaRepayments(database, submissionId) {
  if (!database || !submissionId) return { applied: 0 };
  const submission = await d1First(database, 'SELECT id, period FROM payroll_submissions WHERE id=? LIMIT 1', [submissionId]);
  if (!submission) return { applied: 0 };
  let rows = [];
  try {
    rows = await d1All(
      database,
      `SELECT r.id, r.amount, r.fee, r.repayment, r.status, r.employee_id,
          l.deduction_amount, l.net_amount, l.components
        FROM ewa_requests r
        JOIN payroll_run_lines l ON l.submission_id=? AND l.employee_id=r.employee_id AND l.included=1
        WHERE r.status IN ('DISBURSED','REPAYING') AND r.period=?`,
      [submissionId, submission.period],
    );
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return { applied: 0 };
    throw error;
  }
  let applied = 0;
  for (const row of rows) {
    const components = parseComponents(row.components);
    const repayment = Math.max(0, Math.round(Number(row.repayment || (Number(row.amount) + Number(row.fee))) || 0));
    if (hasEwaComponent(components)) {
      if (row.status === 'DISBURSED') {
        await d1Run(
          database,
          `UPDATE ewa_requests SET status='REPAYING', payroll_submission_id=?,
            applied_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id=?`,
          [submissionId, row.id],
        );
      }
      continue;
    }
    const net = Number(row.net_amount || 0);
    if (repayment <= 0 || net - repayment <= 0) continue;
    const next = attachEwa(components, Number(row.amount) || 0, Number(row.fee) || 0);
    await d1Run(
      database,
      `UPDATE payroll_run_lines SET deduction_amount=?, net_amount=?, components=?,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE submission_id=? AND employee_id=? AND included=1`,
      [Number(row.deduction_amount || 0) + repayment, net - repayment, JSON.stringify(next), submissionId, row.employee_id],
    );
    await d1Run(
      database,
      `UPDATE ewa_requests SET status='REPAYING', payroll_submission_id=?,
        applied_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=?`,
      [submissionId, row.id],
    );
    applied += 1;
  }
  return { applied };
}

export async function markEwaRepaid(database, submissionId) {
  if (!database || !submissionId) return;
  try {
    await d1Run(
      database,
      `UPDATE ewa_requests SET status='REPAID', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE payroll_submission_id=? AND status='REPAYING'`,
      [submissionId],
    );
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || error))) return;
    throw error;
  }
}
