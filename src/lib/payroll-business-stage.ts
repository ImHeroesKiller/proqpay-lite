import {
  BUSINESS_STAGE_META as CORE_META,
  PAYROLL_BUSINESS_STAGE_COUNT as CORE_COUNT,
  PAYROLL_BUSINESS_STAGE_ORDER as CORE_ORDER,
  derivePayrollBusinessStage as deriveCore,
  payrollBusinessStage as stageCore,
  payrollBusinessStageIndex as indexCore,
  payrollBusinessStageLabel as labelCore,
} from './payroll-business-stage-core.js';

export type PayrollBusinessStage = 'PREPARE' | 'REVIEW' | 'APPROVE' | 'PAY' | 'CLOSE';
export type PayrollBusinessStatus = 'IN_PROGRESS' | 'ACTION_REQUIRED' | 'FOR_APPROVAL' | 'PROCESSING' | 'COMPLETED';

export type PayrollBusinessContext = {
  state?: unknown;
  submissionState?: unknown;
  paymentInstructionStatus?: unknown;
  piStatus?: unknown;
  reconciliationStatus?: unknown;
  recStatus?: unknown;
  invoiceStatus?: unknown;
  arStatus?: unknown;
  periodStatus?: unknown;
  blockingCount?: number | string | null;
  openExceptionCount?: number | string | null;
  exceptionCount?: number | string | null;
};

export type PayrollBusinessStageResult = {
  stage: PayrollBusinessStage;
  label: string;
  description: string;
  view: 'operations' | 'payments' | 'billing';
  index: number;
  progress: number;
  status: PayrollBusinessStatus;
  reason: string;
  source: string;
  sourceValue: string;
  technicalState: string;
  paymentInstructionStatus: string | null;
  reconciliationStatus: string | null;
  knownState: boolean;
  isTerminal: boolean;
};

export const PAYROLL_BUSINESS_STAGE_ORDER = CORE_ORDER as readonly PayrollBusinessStage[];
export const PAYROLL_BUSINESS_STAGE_COUNT = CORE_COUNT;
export const BUSINESS_STAGE_META = CORE_META as Readonly<Record<PayrollBusinessStage, {
  label:string;
  description:string;
  view:'operations'|'payments'|'billing';
}>>;

export function derivePayrollBusinessStage(context: PayrollBusinessContext = {}): PayrollBusinessStageResult {
  return deriveCore(context) as PayrollBusinessStageResult;
}

export function payrollBusinessStage(state: unknown): PayrollBusinessStage {
  return stageCore(state) as PayrollBusinessStage;
}

export function payrollBusinessStageLabel(state: unknown) {
  return labelCore(state);
}

export function payrollBusinessStageIndex(state: unknown, piStatus?: unknown, recStatus?: unknown) {
  return indexCore(state, piStatus, recStatus);
}
