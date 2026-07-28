export type PayrollEmployeeRow = {
  name: string;
  company: string;
  salaryGross: number;
  gross: number;
  deduction: number;
  net: number;
};

function rowOf(item: any): PayrollEmployeeRow {
  const gross = Number(item.gross || item.salaryGross || 0);
  const net = Number(item.net || 0);
  return {
    name: String(item.name || item.employeeName || item.employeeId || 'Tanpa nama'),
    company: String(item.company || 'Tanpa klien'),
    salaryGross: Number(item.salaryGross || 0),
    gross,
    deduction: Math.max(0, gross - net),
    net,
  };
}

export function payrollEmployeeRows(payroll: any): PayrollEmployeeRow[] {
  return (Array.isArray(payroll?.details) ? payroll.details : []).map(rowOf);
}

export function rankPayrollEmployees(
  payroll: any,
  direction: 'LOWEST' | 'HIGHEST',
  limit = 10
): PayrollEmployeeRow[] {
  const factor = direction === 'LOWEST' ? 1 : -1;
  return payrollEmployeeRows(payroll)
    .sort((a, b) => factor * (a.salaryGross - b.salaryGross) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit));
}

export function payrollReadiness(payroll: any, validationErrors: number) {
  if (!payroll) {
    return {
      readyForApproval: false,
      readyForPayment: false,
      reason: 'Payroll belum dibuat.',
    };
  }
  const status = String(payroll.status || 'DRAFT');
  return {
    readyForApproval: status === 'CALCULATED',
    readyForPayment:
      ['APPROVED', 'PAYMENT_INSTRUCTION', 'PAID'].includes(status) &&
      Number(validationErrors || 0) === 0,
    reason:
      Number(validationErrors || 0) > 0
        ? `${Number(validationErrors)} error validasi masih memblokir payment instruction.`
        : 'Tidak ada error validasi yang memblokir payment instruction.',
  };
}
