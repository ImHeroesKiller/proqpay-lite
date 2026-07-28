export type PayrollPreview = {
  planId: string;
  period: string;
  employeeCount: number;
  totalGross: number;
  totalDeduction: number;
  totalNet: number;
  validationErrors: number;
};

export function buildPayrollPreview(payroll: any, validationErrors: number, planId: string): PayrollPreview {
  return {
    planId,
    period: String(payroll.period),
    employeeCount: Number(payroll.summary?.employeeCount || 0),
    totalGross: Number(payroll.summary?.totalGross || 0),
    totalDeduction: Number(payroll.summary?.totalDeduction || 0),
    totalNet: Number(payroll.summary?.totalNet || 0),
    validationErrors: Number(validationErrors || 0),
  };
}

export function buildPayrollBreakdown(payroll: any): {
  components: Record<string, number>;
  clients: Record<string, { count: number; gross: number; net: number }>;
} {
  const details = Array.isArray(payroll?.details) ? payroll.details : [];
  const components = details.reduce(
    (totals: Record<string, number>, item: any) => {
      totals['Gaji pokok'] += Number(item.salaryGross || 0);
      totals['Tunjangan transport'] += Number(item.allowanceTransport || 0);
      totals['Tunjangan makan'] += Number(item.allowanceMeal || 0);
      Object.entries(item.deductionBreakdown || {}).forEach(([name, amount]) => {
        totals[`Potongan ${name}`] = (totals[`Potongan ${name}`] || 0) + Number(amount || 0);
      });
      return totals;
    },
    {
      'Gaji pokok': 0,
      'Tunjangan transport': 0,
      'Tunjangan makan': 0,
    }
  );
  const clients = details.reduce((groups: Record<string, { count: number; gross: number; net: number }>, item: any) => {
    const name = String(item.company || 'Tanpa klien');
    groups[name] ||= { count: 0, gross: 0, net: 0 };
    groups[name].count += 1;
    groups[name].gross += Number(item.gross || 0);
    groups[name].net += Number(item.net || 0);
    return groups;
  }, {});
  return { components, clients };
}
