import type { ServiceCapability, ServiceTier } from './service-plan';
import { capabilitiesForTier } from './service-plan';

export type PayrollWorkflowState =
  | 'DRAFT' | 'SUBMITTED' | 'INGESTING' | 'AI_VALIDATING' | 'EXCEPTION_FOUND'
  | 'CLIENT_ACTION_REQUIRED' | 'CLIENT_RESUBMITTED' | 'VALIDATED' | 'STANDARDIZED'
  | 'CONTROLLER_REVIEW' | 'REVISION_REQUIRED' | 'DATA_APPROVED' | 'PAYROLL_FINALIZED'
  | 'PAYMENT_INSTRUCTION_READY' | 'PAYMENT_APPROVAL_PENDING' | 'APPROVED_FOR_PAYMENT'
  | 'DISBURSEMENT_PROCESSING' | 'PROOF_UPLOADED' | 'RECONCILIATION'
  | 'PAYMENT_EXCEPTION' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export type WorkflowActor = 'SUPER_ADMIN' | 'PAYROLL_PROCESSOR' | 'PAYROLL_CONTROLLER' | 'CLIENT_USER';

type Rule = { to: PayrollWorkflowState; roles: WorkflowActor[]; capability?: ServiceCapability };

const RULES: Partial<Record<PayrollWorkflowState, Rule[]>> = {
  DRAFT: [{ to: 'SUBMITTED', roles: ['CLIENT_USER', 'PAYROLL_PROCESSOR'] }],
  SUBMITTED: [
    { to: 'AI_VALIDATING', roles: ['PAYROLL_PROCESSOR'], capability: 'ESSENTIAL_PAYMENT_VALIDATION' },
    { to: 'INGESTING', roles: ['PAYROLL_PROCESSOR'], capability: 'RAW_PAYROLL_IMPORT' },
  ],
  INGESTING: [{ to: 'AI_VALIDATING', roles: ['PAYROLL_PROCESSOR'] }],
  AI_VALIDATING: [
    { to: 'EXCEPTION_FOUND', roles: ['PAYROLL_PROCESSOR'] },
    { to: 'VALIDATED', roles: ['PAYROLL_PROCESSOR'] },
  ],
  EXCEPTION_FOUND: [{ to: 'CLIENT_ACTION_REQUIRED', roles: ['PAYROLL_PROCESSOR'] }],
  CLIENT_ACTION_REQUIRED: [{ to: 'CLIENT_RESUBMITTED', roles: ['CLIENT_USER'] }],
  CLIENT_RESUBMITTED: [{ to: 'AI_VALIDATING', roles: ['PAYROLL_PROCESSOR'] }],
  VALIDATED: [{ to: 'STANDARDIZED', roles: ['PAYROLL_PROCESSOR'] }],
  STANDARDIZED: [{ to: 'CONTROLLER_REVIEW', roles: ['PAYROLL_PROCESSOR'] }],
  CONTROLLER_REVIEW: [
    { to: 'REVISION_REQUIRED', roles: ['PAYROLL_CONTROLLER'] },
    { to: 'DATA_APPROVED', roles: ['PAYROLL_CONTROLLER'] },
  ],
  REVISION_REQUIRED: [{ to: 'AI_VALIDATING', roles: ['PAYROLL_PROCESSOR'] }],
  DATA_APPROVED: [
    { to: 'PAYROLL_FINALIZED', roles: ['PAYROLL_CONTROLLER'], capability: 'PAYROLL_CALCULATION' },
    { to: 'PAYMENT_INSTRUCTION_READY', roles: ['PAYROLL_CONTROLLER'], capability: 'PAYMENT_INSTRUCTION' },
  ],
  PAYROLL_FINALIZED: [{ to: 'PAYMENT_INSTRUCTION_READY', roles: ['PAYROLL_CONTROLLER'], capability: 'PAYMENT_INSTRUCTION' }],
  PAYMENT_INSTRUCTION_READY: [{ to: 'PAYMENT_APPROVAL_PENDING', roles: ['PAYROLL_CONTROLLER'] }],
  PAYMENT_APPROVAL_PENDING: [{ to: 'APPROVED_FOR_PAYMENT', roles: ['PAYROLL_CONTROLLER'], capability: 'PAYMENT_APPROVAL' }],
  APPROVED_FOR_PAYMENT: [{ to: 'DISBURSEMENT_PROCESSING', roles: ['PAYROLL_CONTROLLER'], capability: 'DISBURSEMENT' }],
  DISBURSEMENT_PROCESSING: [{ to: 'PROOF_UPLOADED', roles: ['PAYROLL_CONTROLLER'] }],
  PROOF_UPLOADED: [{ to: 'RECONCILIATION', roles: ['PAYROLL_CONTROLLER'], capability: 'RECONCILIATION' }],
  RECONCILIATION: [
    { to: 'COMPLETED', roles: ['PAYROLL_CONTROLLER'] },
    { to: 'PAYMENT_EXCEPTION', roles: ['PAYROLL_CONTROLLER'] },
  ],
  PAYMENT_EXCEPTION: [{ to: 'RECONCILIATION', roles: ['PAYROLL_CONTROLLER'] }],
};

export function validateWorkflowTransition(input: {
  from: PayrollWorkflowState;
  to: PayrollWorkflowState;
  actorRole: WorkflowActor;
  tier: ServiceTier;
  blockingExceptions?: number;
}) {
  if (['COMPLETED', 'REJECTED', 'CANCELLED'].includes(input.from)) {
    return { allowed: false, blockers: [`State ${input.from} bersifat final.`] };
  }
  const rule = RULES[input.from]?.find((candidate) => candidate.to === input.to);
  const blockers: string[] = [];
  if (!rule) blockers.push(`Transisi ${input.from} → ${input.to} tidak valid.`);
  if (rule && !rule.roles.includes(input.actorRole)) blockers.push(`Role ${input.actorRole} tidak berwenang.`);
  if (rule?.capability && !capabilitiesForTier(input.tier).has(rule.capability)) {
    blockers.push(`Service plan tidak memiliki capability ${rule.capability}.`);
  }
  if ((input.blockingExceptions || 0) > 0 && ['VALIDATED', 'DATA_APPROVED', 'PAYROLL_FINALIZED', 'APPROVED_FOR_PAYMENT'].includes(input.to)) {
    blockers.push(`${input.blockingExceptions} exception masih memblokir proses.`);
  }
  return { allowed: blockers.length === 0, blockers };
}
