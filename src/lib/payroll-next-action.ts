import {
  derivePayrollNextAction as deriveCore,
  payrollNextActionCode as codeCore,
} from './payroll-next-action-core.js';
import type { PayrollBusinessContext, PayrollBusinessStageResult } from './payroll-business-stage';

export type PayrollNextActionView = 'operations' | 'exceptions' | 'payments' | 'billing' | 'reports';
export type PayrollNextActionTone = 'danger' | 'warning' | 'info' | 'success';
export type PayrollNextActionCategory = 'PREPARE' | 'REVIEW' | 'APPROVAL' | 'PAYMENT' | 'RECONCILIATION' | 'CLOSE' | 'EXCEPTION' | 'WAIT' | 'MONITOR' | 'WORK';

export type PayrollNextActionContext = PayrollBusinessContext & {
  role?: string;
  permissions?: string[];
  inputStatus?: unknown;
  sourceMode?: unknown;
  periodStatus?: unknown;
  hasPaymentInstruction?: boolean;
  paymentInstructionId?: unknown;
};

export type PayrollNextAction = {
  code: string;
  label: string;
  description: string;
  view: PayrollNextActionView;
  actionable: boolean;
  tone: PayrollNextActionTone;
  priority: number;
  category: PayrollNextActionCategory;
  workflowCommand: string | null;
  owner: string | null;
  stage: PayrollBusinessStageResult;
};

export function derivePayrollNextAction(context: PayrollNextActionContext = {}): PayrollNextAction {
  return deriveCore(context) as PayrollNextAction;
}

export function payrollNextActionCode(context: PayrollNextActionContext = {}) {
  return codeCore(context);
}
