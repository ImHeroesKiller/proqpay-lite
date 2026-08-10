export type ServiceTier =
  | 'TIER_1_PAYMENT_PROCESSING'
  | 'TIER_2_MANAGED_PAYROLL'
  | 'TIER_3_INTEGRATED_AUTOMATION';

export type ServiceCapability =
  | 'FILE_UPLOAD'
  | 'ESSENTIAL_PAYMENT_VALIDATION'
  | 'PAYMENT_INSTRUCTION'
  | 'PAYMENT_APPROVAL'
  | 'DISBURSEMENT'
  | 'RECONCILIATION'
  | 'REPORTING'
  | 'RAW_PAYROLL_IMPORT'
  | 'PAYROLL_CALCULATION'
  | 'PAYROLL_RULES'
  | 'ATTENDANCE'
  | 'OVERTIME'
  | 'BPJS'
  | 'TAX'
  | 'PAYROLL_EXCEPTION_MANAGEMENT'
  | 'API_INTEGRATION'
  | 'SCHEDULED_SYNC'
  | 'WEBHOOK'
  | 'AUTOMATED_VALIDATION'
  | 'AUTOMATED_PAYROLL_PREPARATION'
  | 'SYSTEM_CALLBACK';

export type ServicePlan = {
  id: string;
  clientId: string;
  tier: ServiceTier;
  status: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  contractReference?: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  createdBy: string;
};

const TIER_1: readonly ServiceCapability[] = [
  'FILE_UPLOAD', 'ESSENTIAL_PAYMENT_VALIDATION', 'PAYMENT_INSTRUCTION',
  'PAYMENT_APPROVAL', 'DISBURSEMENT', 'RECONCILIATION', 'REPORTING',
];

const TIER_2: readonly ServiceCapability[] = [
  ...TIER_1, 'RAW_PAYROLL_IMPORT', 'PAYROLL_CALCULATION', 'PAYROLL_RULES',
  'ATTENDANCE', 'OVERTIME', 'BPJS', 'TAX', 'PAYROLL_EXCEPTION_MANAGEMENT',
];

const TIER_3: readonly ServiceCapability[] = [
  ...TIER_2, 'API_INTEGRATION', 'SCHEDULED_SYNC', 'WEBHOOK',
  'AUTOMATED_VALIDATION', 'AUTOMATED_PAYROLL_PREPARATION', 'SYSTEM_CALLBACK',
];

export function capabilitiesForTier(tier: ServiceTier): ReadonlySet<ServiceCapability> {
  const capabilities = tier === 'TIER_1_PAYMENT_PROCESSING' ? TIER_1
    : tier === 'TIER_2_MANAGED_PAYROLL' ? TIER_2 : TIER_3;
  return new Set(capabilities);
}

export function resolveEffectiveServicePlan(plans: ServicePlan[], clientId: string, at: string) {
  const time = Date.parse(at);
  return plans
    .filter((plan) => plan.clientId === clientId && plan.status === 'ACTIVE')
    .filter((plan) => Date.parse(plan.effectiveFrom) <= time)
    .filter((plan) => !plan.effectiveUntil || Date.parse(plan.effectiveUntil) >= time)
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom))[0] || null;
}

export function hasCapability(plan: ServicePlan | null, capability: ServiceCapability) {
  return Boolean(plan && capabilitiesForTier(plan.tier).has(capability));
}
