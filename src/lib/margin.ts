import { formatIDR } from './format';
import type { BillingSettings } from './database';

/**
 * Margin outsourcing payroll:
 * Revenue ≈ total invoice (tagihan ke client)
 * Cost   ≈ total payroll net (biaya gaji)
 * Margin = revenue - cost
 */
export function calcMargin(db: any, period?: string, billing: BillingSettings = {}) {
  const p = period || db.meta?.currentPeriod || '2025-07';

  const invoices = (db.invoices || []).filter((inv: any) => inv.period === p);
  let revenue = invoices.reduce(
    (s: number, inv: any) => s + (inv.totalAmount || inv.amount || 0),
    0
  );

  // Jika belum ada invoice periode ini, estimasi service fee standar
  if (!invoices.length && db.companies?.length) {
    const empCount = db.employees?.length || 0;
    const serviceFeePerEmp = Number(billing.serviceFeePerEmp ?? 1_500_000);
    const bpjsFeePerEmp = Number(billing.bpjsFeePerEmp ?? 300_000);
    const adminFeePerClient = Number(billing.adminFee ?? 2_000_000);
    const serviceFee = empCount * serviceFeePerEmp;
    const bpjsFee = empCount * bpjsFeePerEmp;
    const adminFee = adminFeePerClient * (db.companies?.length || 1);
    const subtotal = serviceFee + bpjsFee + adminFee;
    const tax = Math.round(subtotal * 0.1);
    revenue = subtotal + tax;
  }

  const payroll = (db.payrolls || []).find((x: any) => x.period === p);
  const cost = payroll?.summary?.totalNet || 0;
  const grossCost = payroll?.summary?.totalGross || 0;
  const margin = revenue - cost;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;

  return {
    period: p,
    revenue,
    cost,
    grossCost,
    margin,
    marginPct,
    invoiceCount: invoices.length,
    estimated: invoices.length === 0,
    payrollStatus: payroll?.status || 'BELUM_DIHITUNG',
    employeeCount: payroll?.summary?.employeeCount || db.employees?.length || 0,
    billing: {
      serviceFeePerEmp: Number(billing.serviceFeePerEmp ?? 1_500_000),
      bpjsFeePerEmp: Number(billing.bpjsFeePerEmp ?? 300_000),
      adminFee: Number(billing.adminFee ?? 2_000_000),
    },
  };
}

export function formatMarginReply(m: ReturnType<typeof calcMargin>) {
  const note = m.estimated
    ? `_Invoice periode ini belum diterbitkan — revenue memakai Settings: service fee ${formatIDR(m.billing.serviceFeePerEmp)}/karyawan, BPJS ${formatIDR(m.billing.bpjsFeePerEmp)}/karyawan, dan admin ${formatIDR(m.billing.adminFee)}/client._`
    : `_Dari ${m.invoiceCount} invoice periode ${m.period}._`;

  return (
    `**Margin ${m.period}**\n\n` +
    `- Revenue (tagihan client): **${formatIDR(m.revenue)}**\n` +
    `- Cost (payroll net): **${formatIDR(m.cost)}**\n` +
    `- **Margin: ${formatIDR(m.margin)}** (${m.marginPct.toFixed(1)}%)\n` +
    `- Status payroll: ${m.payrollStatus} · ${m.employeeCount} karyawan\n\n` +
    note
  );
}
