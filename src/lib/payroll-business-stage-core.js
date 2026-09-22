export const PAYROLL_BUSINESS_STAGE_ORDER = Object.freeze([
  'PREPARE',
  'REVIEW',
  'APPROVE',
  'PAY',
  'CLOSE',
]);

export const PAYROLL_BUSINESS_STAGE_COUNT = PAYROLL_BUSINESS_STAGE_ORDER.length;

export const BUSINESS_STAGE_META = Object.freeze({
  PREPARE: Object.freeze({
    label:'Prepare',
    description:'Prepare payroll data and calculation',
    view:'operations',
  }),
  REVIEW: Object.freeze({
    label:'Review',
    description:'Validate data and resolve payroll issues',
    view:'operations',
  }),
  APPROVE: Object.freeze({
    label:'Approve',
    description:'Internal and client payroll approval',
    view:'operations',
  }),
  PAY: Object.freeze({
    label:'Pay',
    description:'Payment instruction, approval and disbursement',
    view:'payments',
  }),
  CLOSE: Object.freeze({
    label:'Close',
    description:'Reconcile, bill and close the cycle',
    view:'billing',
  }),
});

const STAGE_BY_STATE = Object.freeze({
  DRAFT:'PREPARE',
  SUBMITTED:'PREPARE',
  INGESTING:'PREPARE',
  AI_VALIDATING:'PREPARE',

  EXCEPTION_FOUND:'REVIEW',
  EXCEPTION_REVIEW:'REVIEW',
  CLIENT_ACTION_REQUIRED:'REVIEW',
  CLIENT_RESUBMITTED:'REVIEW',
  VALIDATED:'REVIEW',
  STANDARDIZED:'REVIEW',
  CALCULATED:'REVIEW',
  PROCESSOR_REVIEW:'REVIEW',
  REVISION_REQUIRED:'REVIEW',
  REJECTED:'REVIEW',

  CONTROLLER_REVIEW:'APPROVE',
  DATA_APPROVED:'APPROVE',
  PAYROLL_FINALIZED:'APPROVE',
  CLIENT_APPROVAL_PENDING:'APPROVE',
  CLIENT_APPROVED:'APPROVE',
  CLIENT_REVISION_REQUESTED:'APPROVE',

  PAYMENT_INSTRUCTION_READY:'PAY',
  PAYMENT_APPROVAL_PENDING:'PAY',
  APPROVED_FOR_PAYMENT:'PAY',
  DISBURSEMENT_PROCESSING:'PAY',
  PAYMENT_CONFIRMED:'PAY',
  PROOF_UPLOADED:'PAY',

  RECONCILIATION:'CLOSE',
  PAYMENT_EXCEPTION:'CLOSE',
  MATCHED:'CLOSE',
  COMPLETED:'CLOSE',
  INVOICED:'CLOSE',
  CLOSED:'CLOSE',
  CANCELLED:'CLOSE',
});

const STAGE_BY_PI_STATUS = Object.freeze({
  PAYMENT_INSTRUCTION_READY:'PAY',
  PAYMENT_APPROVAL_PENDING:'PAY',
  APPROVED_FOR_PAYMENT:'PAY',
  DISBURSEMENT_PROCESSING:'PAY',
  PAYMENT_CONFIRMED:'PAY',
  PROOF_UPLOADED:'PAY',
  RECONCILIATION:'CLOSE',
  PAYMENT_EXCEPTION:'CLOSE',
  COMPLETED:'CLOSE',
  MATCHED:'CLOSE',
  PAID:'CLOSE',
  RECONCILED:'CLOSE',
});

function normalize(value) {
  return String(value || '').trim().toUpperCase();
}

function closeEvidence(context) {
  const recStatus = normalize(context.reconciliationStatus ?? context.recStatus);
  const invoiceStatus = normalize(context.invoiceStatus);
  const arStatus = normalize(context.arStatus);
  if (recStatus) return { stage:'CLOSE', source:'reconciliation', value:recStatus };
  if (invoiceStatus) return { stage:'CLOSE', source:'invoice', value:invoiceStatus };
  if (arStatus) return { stage:'CLOSE', source:'ar', value:arStatus };
  return null;
}

function deriveBusinessStatus(stage, context, technicalState, piStatus, recStatus) {
  const blocking = Number(context.blockingCount || 0);
  if (['CANCELLED','REJECTED'].includes(technicalState)) return 'COMPLETED';
  const openExceptions = Number(context.openExceptionCount || context.exceptionCount || 0);
  if (stage === 'PREPARE') return 'IN_PROGRESS';
  if (stage === 'REVIEW') {
    if (technicalState === 'CLIENT_ACTION_REQUIRED' || blocking > 0 || openExceptions > 0) return 'ACTION_REQUIRED';
    return 'IN_PROGRESS';
  }
  if (stage === 'APPROVE') {
    if (technicalState === 'CLIENT_REVISION_REQUESTED') return 'ACTION_REQUIRED';
    if (technicalState === 'CLIENT_APPROVED') return 'IN_PROGRESS';
    return 'FOR_APPROVAL';
  }
  if (stage === 'PAY') {
    if (piStatus === 'PAYMENT_APPROVAL_PENDING' || technicalState === 'PAYMENT_APPROVAL_PENDING') return 'FOR_APPROVAL';
    return 'PROCESSING';
  }
  if (technicalState === 'CLOSED'
    || ['PAID','COMPLETED'].includes(normalize(context.invoiceStatus))
    || normalize(context.arStatus) === 'PAID') return 'COMPLETED';
  if (technicalState === 'PAYMENT_EXCEPTION' || recStatus === 'EXCEPTION') return 'ACTION_REQUIRED';
  return 'PROCESSING';
}

function reasonFor(stage, status, context, technicalState, piStatus, recStatus) {
  const blocking = Number(context.blockingCount || 0);
  if (status === 'ACTION_REQUIRED' && blocking > 0) return `${blocking} critical payroll issue${blocking === 1 ? '' : 's'} require resolution`;
  if (technicalState === 'CLIENT_ACTION_REQUIRED') return 'Client correction is required before payroll can continue';
  if (technicalState === 'CLIENT_REVISION_REQUESTED') return 'Payroll revision was requested during approval';
  if (technicalState === 'CLIENT_APPROVAL_PENDING') return 'Payroll is waiting for client approval';
  if (technicalState === 'CLIENT_APPROVED') return 'Client approval is complete; payment preparation can continue';
  if (status === 'FOR_APPROVAL' && (technicalState === 'CONTROLLER_REVIEW' || technicalState === 'DATA_APPROVED')) return 'Payroll is waiting for internal approval';
  if (status === 'FOR_APPROVAL' && (piStatus === 'PAYMENT_APPROVAL_PENDING' || technicalState === 'PAYMENT_APPROVAL_PENDING')) return 'Payment instruction is waiting for approval';
  if (stage === 'PAY' && status === 'PROCESSING') return 'Payment is being prepared or processed';
  if (stage === 'CLOSE' && recStatus === 'MATCHED') return 'Payment is reconciled; billing and closing can continue';
  if (technicalState === 'CANCELLED') return 'Payroll run was cancelled';
  if (technicalState === 'REJECTED') return 'Payroll run was rejected';
  if (stage === 'CLOSE' && status === 'COMPLETED') return 'Payroll cycle is completed';
  if (stage === 'CLOSE') return 'Reconciliation, billing or closing is in progress';
  if (stage === 'REVIEW') return 'Payroll is being reviewed and validated';
  if (stage === 'APPROVE') return 'Payroll is in approval';
  return 'Payroll preparation is in progress';
}

export function derivePayrollBusinessStage(context = {}) {
  const technicalState = normalize(context.state ?? context.submissionState);
  const piStatus = normalize(context.paymentInstructionStatus ?? context.piStatus);
  const recStatus = normalize(context.reconciliationStatus ?? context.recStatus);

  const close = closeEvidence(context);
  let stage;
  let source = 'state';
  let sourceValue = technicalState;

  if (close) {
    stage = close.stage;
    source = close.source;
    sourceValue = close.value;
  } else if (piStatus && STAGE_BY_PI_STATUS[piStatus]) {
    stage = STAGE_BY_PI_STATUS[piStatus];
    source = 'payment_instruction';
    sourceValue = piStatus;
  } else if (technicalState && STAGE_BY_STATE[technicalState]) {
    stage = STAGE_BY_STATE[technicalState];
  } else {
    stage = 'PREPARE';
    source = 'fallback';
    sourceValue = technicalState || 'UNKNOWN';
  }

  const index = PAYROLL_BUSINESS_STAGE_ORDER.indexOf(stage) + 1;
  const status = deriveBusinessStatus(stage, context, technicalState, piStatus, recStatus);
  const knownState = source !== 'fallback';
  return {
    stage,
    label:BUSINESS_STAGE_META[stage].label,
    description:BUSINESS_STAGE_META[stage].description,
    view:BUSINESS_STAGE_META[stage].view,
    index,
    progress:index / PAYROLL_BUSINESS_STAGE_COUNT,
    status:knownState ? status : 'ACTION_REQUIRED',
    reason:knownState
      ? reasonFor(stage, status, context, technicalState, piStatus, recStatus)
      : `Unknown technical state: ${sourceValue}`,
    source,
    sourceValue,
    technicalState,
    paymentInstructionStatus:piStatus || null,
    reconciliationStatus:recStatus || null,
    knownState,
    isTerminal:status === 'COMPLETED' && (stage === 'CLOSE' || ['CANCELLED','REJECTED'].includes(technicalState)),
  };
}

export function payrollBusinessStage(state) {
  return derivePayrollBusinessStage({ state }).stage;
}

export function payrollBusinessStageLabel(state) {
  return derivePayrollBusinessStage({ state }).label;
}

export function payrollBusinessStageIndex(state, piStatus, recStatus) {
  return derivePayrollBusinessStage({ state, piStatus, recStatus }).index;
}
