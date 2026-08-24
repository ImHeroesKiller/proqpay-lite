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
