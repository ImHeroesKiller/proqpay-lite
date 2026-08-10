export type BillingMethod = 'PER_EMPLOYEE' | 'FIXED' | 'PERCENTAGE_OF_PAYROLL' | 'COMPONENT_BASED';

export type BillingRule = {
  id: string;
  clientId: string;
  projectId?: string | null;
  servicePlanId: string;
  method: BillingMethod;
  value: number;
  taxRate?: number;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  version: string;
};

export type BillingInput = {
  clientId: string;
  projectId?: string | null;
  servicePlanId: string;
  period: string;
  employeeCount: number;
  payrollTotal: number;
};

export type BillingResult = {
  ok: true;
  subtotal: number;
  tax: number;
  total: number;
  formula: string;
  inputs: Record<string, number | string>;
  ruleId: string;
  ruleVersion: string;
} | { ok: false; error: string };

export function findEffectiveBillingRule(rules: BillingRule[], input: BillingInput) {
  const at = Date.parse(`${input.period}-01T00:00:00Z`);
  return rules
    .filter((rule) => rule.clientId === input.clientId && rule.servicePlanId === input.servicePlanId)
    .filter((rule) => !rule.projectId || rule.projectId === input.projectId)
    .filter((rule) => Date.parse(rule.effectiveFrom) <= at)
    .filter((rule) => !rule.effectiveUntil || Date.parse(rule.effectiveUntil) >= at)
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom))[0] || null;
}

export function calculateBilling(rule: BillingRule | null, input: BillingInput): BillingResult {
  if (!rule) return { ok: false, error: 'Billing rule belum dikonfigurasi untuk client ini.' };
  let subtotal = 0;
  let formula = '';
  if (rule.method === 'PER_EMPLOYEE') {
    subtotal = input.employeeCount * rule.value;
    formula = 'employeeCount × feePerEmployee';
  } else if (rule.method === 'FIXED') {
    subtotal = rule.value;
    formula = 'fixedFee';
  } else if (rule.method === 'PERCENTAGE_OF_PAYROLL') {
    subtotal = Math.round(input.payrollTotal * rule.value / 100);
    formula = 'payrollTotal × percentage / 100';
  } else {
    return { ok: false, error: 'Billing method COMPONENT_BASED belum memiliki konfigurasi komponen.' };
  }
  const taxRate = Number(rule.taxRate || 0);
  const tax = Math.round(subtotal * taxRate / 100);
  return {
    ok: true, subtotal, tax, total: subtotal + tax, formula,
    inputs: { employeeCount: input.employeeCount, payrollTotal: input.payrollTotal, ruleValue: rule.value, taxRate },
    ruleId: rule.id, ruleVersion: rule.version,
  };
}
