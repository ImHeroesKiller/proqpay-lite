export const PAYROLL_TEMPLATE_VERSION = 'PROQPAY_PAYROLL_V1';

function integer(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function normalizeComponents(components) {
  if (!components || typeof components !== 'object' || Array.isArray(components)) return {};
  const result = {};
  for (const [key, value] of Object.entries(components)) {
    const n = Number(value);
    if (Number.isFinite(n)) result[key] = Math.round(n);
  }
  return result;
}

export function canonicalPayrollRow(row) {
  return {
    nrk: String(row?.nrk || '').trim(),
    name: String(row?.name || '').trim(),
    grossPay: integer(row?.grossPay),
    totalDeductions: integer(row?.totalDeductions),
    netPay: integer(row?.netPay),
    bank: row?.bank == null ? null : String(row.bank).trim(),
    accountNo: row?.accountNo == null ? null : String(row.accountNo).replace(/\s+/g, ''),
    payrollComponents: normalizeComponents(row?.payrollComponents),
  };
}

export function validatePayrollControlRows(rows) {
  const issues = [];
  let gross = 0;
  let deduction = 0;
  let net = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = canonicalPayrollRow(rows[index]);
    const rowNo = index + 1;
    if (row.grossPay == null || row.grossPay < 0) issues.push({ row: rowNo, field: 'grossPay', message: 'Gross wajib angka bulat >= 0' });
    if (row.totalDeductions == null || row.totalDeductions < 0) issues.push({ row: rowNo, field: 'totalDeductions', message: 'Total potongan wajib angka bulat >= 0' });
    if (row.netPay == null || row.netPay < 0) issues.push({ row: rowNo, field: 'netPay', message: 'Net/THP wajib angka bulat >= 0' });
    if (row.grossPay != null && row.totalDeductions != null && row.netPay != null
      && row.grossPay - row.totalDeductions !== row.netPay) {
      issues.push({ row: rowNo, field: 'controlTotal', message: `Gross - Potongan harus sama dengan Net/THP (${row.grossPay} - ${row.totalDeductions} != ${row.netPay})` });
    }
    if (!row.bank) issues.push({ row: rowNo, field: 'bank', message: 'Bank wajib diisi untuk payroll final' });
    if (!/^\d{6,34}$/.test(row.accountNo || '')) issues.push({ row: rowNo, field: 'accountNo', message: 'Nomor rekening wajib 6-34 digit' });
    gross += row.grossPay || 0;
    deduction += row.totalDeductions || 0;
    net += row.netPay || 0;
  }
  if (gross - deduction !== net) {
    issues.push({ row: 0, field: 'batchControlTotal', message: `Control total file tidak balance: Gross ${gross} - Potongan ${deduction} != Net ${net}` });
  }
  return {
    ok: issues.length === 0,
    issues: issues.slice(0, 200),
    totals: { gross, deduction, net, employees: rows.length },
  };
}
