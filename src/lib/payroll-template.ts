export const PAYROLL_TEMPLATE_VERSION = 'PROQPAY_PAYROLL_V1';
export const PAYROLL_TEMPLATE_URL = '/templates/ProQPay-Data-Intake-Template-v1.xlsx';
export const PAYROLL_TEMPLATE_SHEETS = ['01_PAYROLL_DATA','02_EMPLOYEE_REFERENCE','03_CONTROL_TOTAL'] as const;
export const PAYROLL_REQUIRED_CONTROLS = ['Gross','Deduct','Netto','Balance Check'] as const;

export async function downloadPayrollTemplate() {
  const anchor = document.createElement('a');
  anchor.href = PAYROLL_TEMPLATE_URL;
  anchor.download = 'ProQPay-Data-Intake-Template-v1.xlsx';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
