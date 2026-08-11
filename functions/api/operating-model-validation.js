const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIERS = new Set([
  'TIER_1_PAYMENT_PROCESSING',
  'TIER_2_MANAGED_PAYROLL',
  'TIER_3_INTEGRATED_AUTOMATION',
]);
const STATES = new Set([
  'DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','EXCEPTION_FOUND',
  'CLIENT_ACTION_REQUIRED','CLIENT_RESUBMITTED','VALIDATED','STANDARDIZED',
  'CONTROLLER_REVIEW','REVISION_REQUIRED','DATA_APPROVED','PAYROLL_FINALIZED',
  'PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT',
  'DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION',
  'PAYMENT_EXCEPTION','COMPLETED','REJECTED','CANCELLED',
]);

const TRANSITIONS = Object.freeze({
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['INGESTING', 'AI_VALIDATING'],
  INGESTING: ['AI_VALIDATING'],
  AI_VALIDATING: ['EXCEPTION_FOUND', 'VALIDATED'],
  EXCEPTION_FOUND: ['CLIENT_ACTION_REQUIRED'],
  CLIENT_ACTION_REQUIRED: ['CLIENT_RESUBMITTED'],
  CLIENT_RESUBMITTED: ['AI_VALIDATING'],
  VALIDATED: ['STANDARDIZED'],
  STANDARDIZED: ['CONTROLLER_REVIEW'],
  CONTROLLER_REVIEW: ['REVISION_REQUIRED', 'DATA_APPROVED'],
  REVISION_REQUIRED: ['AI_VALIDATING'],
  DATA_APPROVED: ['PAYROLL_FINALIZED', 'PAYMENT_INSTRUCTION_READY'],
  PAYROLL_FINALIZED: ['PAYMENT_INSTRUCTION_READY'],
  PAYMENT_INSTRUCTION_READY: ['PAYMENT_APPROVAL_PENDING'],
  PAYMENT_APPROVAL_PENDING: ['APPROVED_FOR_PAYMENT'],
  APPROVED_FOR_PAYMENT: ['DISBURSEMENT_PROCESSING'],
  DISBURSEMENT_PROCESSING: ['PROOF_UPLOADED'],
  PROOF_UPLOADED: ['RECONCILIATION'],
  RECONCILIATION: ['PAYMENT_EXCEPTION', 'COMPLETED'],
  PAYMENT_EXCEPTION: ['RECONCILIATION'],
});

function validId(value) {
  return ID.test(String(value || ''));
}

export function validateOperatingAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['JSON object required'] };
  }
  const action = String(input.action || '');
  const errors = [];
  if (!action) errors.push('action wajib diisi');

  if (action === 'CREATE_SERVICE_PLAN') {
    if (!validId(input.clientId)) errors.push('clientId tidak valid');
    if (!TIERS.has(input.tier)) errors.push('tier tidak valid');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.effectiveFrom || ''))) errors.push('effectiveFrom tidak valid');
  } else if (action === 'CREATE_SUBMISSION') {
    for (const key of ['clientId', 'servicePlanId']) if (!validId(input[key])) errors.push(`${key} tidak valid`);
    if (!PERIOD.test(String(input.period || ''))) errors.push('period tidak valid');
  } else if (action === 'TRANSITION_SUBMISSION') {
    if (!validId(input.submissionId)) errors.push('submissionId tidak valid');
    if (!STATES.has(input.toState)) errors.push('toState tidak valid');
  } else if (action === 'CREATE_EXCEPTION') {
    if (!validId(input.submissionId)) errors.push('submissionId tidak valid');
    if (!['CRITICAL', 'WARNING', 'INFO'].includes(input.severity)) errors.push('severity tidak valid');
    if (!validId(input.category)) errors.push('category tidak valid');
  } else if (action === 'CREATE_VALIDATION_BATCH') {
    if (!validId(input.submissionId)) errors.push('submissionId tidak valid');
    if (!Array.isArray(input.issues) || input.issues.length > 2000) errors.push('issues wajib berupa array maksimal 2000 item');
  } else if (action === 'REQUEST_CLIENT_ACTION') {
    if (!validId(input.exceptionId)) errors.push('exceptionId tidak valid');
    if (!String(input.message || '').trim()) errors.push('message wajib diisi');
  } else if (action === 'ADD_EXCEPTION_NOTE') {
    if (!validId(input.exceptionId)) errors.push('exceptionId tidak valid');
    if (!String(input.message || '').trim()) errors.push('message wajib diisi');
  } else if (action === 'RESOLVE_EXCEPTION') {
    if (!validId(input.exceptionId)) errors.push('exceptionId tidak valid');
    if (!['ACCEPTED', 'REJECTED', 'RESOLVED'].includes(input.status)) errors.push('status resolusi tidak valid');
    if (!String(input.resolutionNote || '').trim()) errors.push('resolutionNote wajib diisi');
  } else if (action === 'CREATE_PAYMENT_INSTRUCTION') {
    for (const key of ['clientId', 'idempotencyKey']) if (!validId(input[key])) errors.push(`${key} tidak valid`);
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 1000) errors.push('lines wajib 1-1000 item');
    if (!Number.isSafeInteger(input.expectedTotal) || input.expectedTotal <= 0) errors.push('expectedTotal tidak valid');
    for (const line of input.lines || []) {
      if (!line || !Number.isSafeInteger(line.amount) || line.amount <= 0) errors.push('line amount tidak valid');
      if (!String(line.beneficiaryName || '').trim()) errors.push('beneficiaryName wajib diisi');
      if (!String(line.bankName || '').trim()) errors.push('bankName wajib diisi');
      if (!String(line.maskedAccount || '').trim()) errors.push('maskedAccount wajib diisi');
    }
  } else if (action === 'APPROVE_PAYMENT') {
    if (!validId(input.paymentInstructionId)) errors.push('paymentInstructionId tidak valid');
    if (!validId(input.actionHash)) errors.push('actionHash tidak valid');
    if (input.confirmation !== 'KONFIRMASI PAYMENT') errors.push('Konfirmasi wajib: KONFIRMASI PAYMENT');
  } else if (action === 'UPLOAD_PAYMENT_PROOF') {
    if (!validId(input.paymentInstructionId)) errors.push('paymentInstructionId tidak valid');
    if (!String(input.bank || '').trim()) errors.push('bank wajib diisi');
    if (!String(input.reference || '').trim()) errors.push('reference wajib diisi');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.transactionDate || ''))) errors.push('transactionDate tidak valid');
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errors.push('amount tidak valid');
    if (!validId(input.uploadedFileId)) errors.push('uploadedFileId tidak valid');
  } else if (action === 'RECONCILE_PAYMENT') {
    if (!validId(input.paymentInstructionId)) errors.push('paymentInstructionId tidak valid');
  } else if (action === 'CREATE_INTEGRATION') {
    for (const key of ['clientId', 'servicePlanId']) if (!validId(input[key])) errors.push(`${key} tidak valid`);
    if (!['HRIS','ATTENDANCE','ACCOUNTING','BANK'].includes(input.connectorType)) errors.push('connectorType tidak valid');
  } else if (action) {
    errors.push('action tidak dikenal');
  }
  return { ok: errors.length === 0, errors };
}

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function instructionTotal(lines) {
  return (lines || []).reduce((sum, line) => sum + Number(line.amount || 0), 0);
}

export { TIERS, STATES };
