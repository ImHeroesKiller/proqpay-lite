import { derivePayrollBusinessStage } from './payroll-business-stage-core.js';

const PROCESSOR_ROLES = new Set(['SUPER_ADMIN','PAYROLL_PROCESSOR']);
const CONTROLLER_ROLES = new Set(['SUPER_ADMIN','PAYROLL_CONTROLLER']);

function normalize(value) {
  return String(value || '').trim().toUpperCase();
}

function hasPermission(context, permission) {
  return Array.isArray(context.permissions) && context.permissions.map(String).includes(permission);
}

function result(code, label, description, view, {
  actionable = true,
  tone = 'info',
  priority = 3,
  category = 'WORK',
  workflowCommand = null,
  owner = null,
} = {}) {
  return Object.freeze({
    code,
    label,
    description,
    view,
    actionable,
    tone,
    priority,
    category,
    workflowCommand,
    owner,
  });
}

const MONITOR = {
  payroll: () => result('TRACK_PAYROLL','View Payroll Status','No action is required from you right now.','operations',{actionable:false,tone:'info',priority:5,category:'MONITOR'}),
  controller: () => result('WAIT_CONTROLLER','Waiting for Controller','Payroll is waiting for Controller review.','operations',{actionable:false,tone:'info',priority:5,category:'WAIT',owner:'PAYROLL_CONTROLLER'}),
  client: () => result('WAIT_CLIENT_CORRECTION','Waiting for Client','Client correction is required before payroll can continue.','operations',{actionable:false,tone:'warning',priority:4,category:'WAIT',owner:'CLIENT_USER'}),
  processor: () => result('WAIT_PROCESSOR','Waiting for Processor','Payroll preparation must be completed by the Processor.','operations',{actionable:false,tone:'info',priority:5,category:'WAIT',owner:'PAYROLL_PROCESSOR'}),
  paymentApproval: () => result('WAIT_PAYMENT_APPROVAL','Waiting for Payment Approval','Payment Instruction is waiting for Controller approval.','payments',{actionable:false,tone:'warning',priority:4,category:'WAIT',owner:'PAYROLL_CONTROLLER'}),
  paymentExecution: () => result('WAIT_PAYMENT_EXECUTION','Waiting for Payment Execution','Payment is approved and waiting for execution.','payments',{actionable:false,tone:'info',priority:4,category:'WAIT',owner:'PAYROLL_PROCESSOR'}),
  payment: () => result('MONITOR_PAYMENT','Monitor Payment','Payment is being processed.','payments',{actionable:false,tone:'info',priority:5,category:'MONITOR'}),
};

function clientAction(context, stage) {
  const state = normalize(context.state ?? context.submissionState);
  if (state === 'CLIENT_ACTION_REQUIRED') {
    return result('CORRECT_PAYROLL_DATA','Correct Payroll Data','Payroll has items that require client correction.','exceptions',{
      actionable:true,tone:'danger',priority:1,category:'EXCEPTION',owner:'CLIENT_USER',
    });
  }
  if (state === 'CLIENT_APPROVAL_PENDING') {
    return result('APPROVE_PAYROLL','Approve Payroll','Final payroll is ready for client sign-off.','operations',{
      actionable:true,tone:'warning',priority:2,category:'APPROVAL',owner:'CLIENT_USER',
    });
  }
  if (state === 'CLIENT_REVISION_REQUESTED') {
    return result('REVIEW_PAYROLL_REVISION','Review Payroll Revision','A payroll revision requires your attention.','exceptions',{
      actionable:true,tone:'warning',priority:2,category:'EXCEPTION',owner:'CLIENT_USER',
    });
  }
  if (stage.stage === 'PAY') return MONITOR.payment();
  if (stage.stage === 'CLOSE') {
    return result('VIEW_RESULTS','View Results','Payroll result, payment status and documents are available.','billing',{
      actionable:false,tone:stage.isTerminal?'success':'info',priority:5,category:'MONITOR',
    });
  }
  return MONITOR.payroll();
}

function processorAction(context, stage) {
  const state = normalize(context.state ?? context.submissionState);
  const piStatus = normalize(context.paymentInstructionStatus ?? context.piStatus);
  const hasPi = Boolean(context.hasPaymentInstruction || context.paymentInstructionId || piStatus);
  const inputStatus = normalize(context.inputStatus);
  const sourceMode = normalize(context.sourceMode);

  if (state === 'CLIENT_ACTION_REQUIRED') return MONITOR.client();

  if (Number(context.blockingCount || 0) > 0 || state === 'EXCEPTION_FOUND') {
    return result('RESOLVE_PAYROLL_ISSUES','Resolve Payroll Issues','Critical payroll findings must be resolved before approval.','exceptions',{
      actionable:true,tone:'danger',priority:1,category:'EXCEPTION',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (inputStatus === 'PENDING') {
    if (sourceMode === 'UPLOAD_FINAL') {
      return result('UPLOAD_PAYROLL_DATA','Upload Payroll Data','Upload and review the final payroll input before validation.','operations',{
        actionable:true,tone:'warning',priority:2,category:'PREPARE',owner:'PAYROLL_PROCESSOR',
      });
    }
    return result('FINALIZE_PAYROLL_INPUT','Finalize Payroll Input','Review the payroll snapshot and finalize the input.','operations',{
      actionable:true,tone:'warning',priority:2,category:'PREPARE',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','CLIENT_RESUBMITTED','REVISION_REQUIRED'].includes(state)) {
    return result('VALIDATE_PAYROLL','Validate Payroll','Run payroll validation and continue the review cycle.','operations',{
      actionable:true,tone:'info',priority:3,category:'REVIEW',workflowCommand:'ADVANCE_VALIDATE',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (['VALIDATED','STANDARDIZED','CALCULATED','PROCESSOR_REVIEW'].includes(state)) {
    return result('FINALIZE_PAYROLL','Finalize Payroll','Complete Processor review and send payroll to Controller.','operations',{
      actionable:true,tone:'info',priority:3,category:'REVIEW',workflowCommand:'ADVANCE_FINALIZE',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (state === 'CONTROLLER_REVIEW') return MONITOR.controller();
  if (['DATA_APPROVED','PAYROLL_FINALIZED'].includes(state)) {
    return result('WAIT_PAYMENT_PREPARATION','Waiting for Payment Preparation','Controller must open the payment preparation checkpoint.','operations',{
      actionable:false,tone:'info',priority:5,category:'WAIT',owner:'PAYROLL_CONTROLLER',
    });
  }

  if (state === 'PAYMENT_INSTRUCTION_READY' || piStatus === 'PAYMENT_INSTRUCTION_READY') {
    if (hasPi) {
      return result('SUBMIT_PAYMENT_INSTRUCTION','Submit Payment Instruction','Payment Instruction is ready to be submitted for approval.','payments',{
        actionable:true,tone:'warning',priority:2,category:'PAYMENT',owner:'PAYROLL_PROCESSOR',
      });
    }
    return result('GENERATE_PAYMENT_INSTRUCTION','Generate Payment Instruction','Create the immutable Payment Instruction from the approved payroll.','operations',{
      actionable:true,tone:'warning',priority:2,category:'PAYMENT',workflowCommand:'GENERATE_PAYMENT_INSTRUCTION',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (state === 'PAYMENT_APPROVAL_PENDING' || piStatus === 'PAYMENT_APPROVAL_PENDING') return MONITOR.paymentApproval();

  if (state === 'APPROVED_FOR_PAYMENT' || piStatus === 'APPROVED_FOR_PAYMENT') {
    return result('PROCESS_PAYMENT','Process Payment','Approved payment is ready for execution.','payments',{
      actionable:true,tone:'warning',priority:2,category:'PAYMENT',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (['DISBURSEMENT_PROCESSING','PAYMENT_CONFIRMED'].includes(state) || ['DISBURSEMENT_PROCESSING','PAYMENT_CONFIRMED'].includes(piStatus)) {
    return MONITOR.payment();
  }

  if (['PROOF_UPLOADED','RECONCILIATION'].includes(state) || ['PROOF_UPLOADED','RECONCILIATION'].includes(piStatus)
    || normalize(context.reconciliationStatus ?? context.recStatus) === 'PENDING') {
    return result('RECONCILE_PAYMENT','Reconcile Payment','Match payment evidence against the approved Payment Instruction.','payments',{
      actionable:true,tone:'warning',priority:2,category:'RECONCILIATION',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (state === 'PAYMENT_EXCEPTION' || piStatus === 'PAYMENT_EXCEPTION') {
    return result('RESOLVE_PAYMENT_EXCEPTION','Resolve Payment Exception','Payment exception must be resolved before closing.','payments',{
      actionable:true,tone:'danger',priority:1,category:'EXCEPTION',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (stage.stage === 'CLOSE') {
    const recStatus = normalize(context.reconciliationStatus ?? context.recStatus);
    const invoiceStatus = normalize(context.invoiceStatus);
    if ((recStatus === 'MATCHED' || state === 'COMPLETED') && !invoiceStatus) {
      return result('PREPARE_BILLING','Continue to Billing','Payment is reconciled. Prepare billing and continue period closing.','billing',{
        actionable:true,tone:'info',priority:3,category:'CLOSE',owner:'PAYROLL_PROCESSOR',
      });
    }
    return result('CONTINUE_CLOSE','Continue Closing','Complete billing, collection, and remaining closing activities.','billing',{
      actionable:true,tone:'info',priority:3,category:'CLOSE',owner:'PAYROLL_PROCESSOR',
    });
  }

  return MONITOR.payroll();
}

function controllerAction(context, stage) {
  const state = normalize(context.state ?? context.submissionState);
  const piStatus = normalize(context.paymentInstructionStatus ?? context.piStatus);
  const hasPi = Boolean(context.hasPaymentInstruction || context.paymentInstructionId || piStatus);
  const canApprovePayment = CONTROLLER_ROLES.has(normalize(context.role))
    || hasPermission(context,'payment:approve') || hasPermission(context,'PAYMENT_APPROVER');

  if (state === 'CLIENT_ACTION_REQUIRED') return MONITOR.client();

  if (Number(context.blockingCount || 0) > 0 || state === 'EXCEPTION_FOUND') {
    return result('WAIT_PAYROLL_CORRECTION','Waiting for Payroll Correction','Critical findings must be resolved before Controller review.','exceptions',{
      actionable:false,tone:'danger',priority:4,category:'WAIT',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (['DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','CLIENT_RESUBMITTED','REVISION_REQUIRED','VALIDATED','STANDARDIZED','CALCULATED','PROCESSOR_REVIEW'].includes(state)) {
    return MONITOR.processor();
  }

  if (state === 'CONTROLLER_REVIEW') {
    return result('REVIEW_APPROVE_PAYROLL','Review & Approve Payroll','Payroll is ready for Controller review and approval.','operations',{
      actionable:true,tone:'warning',priority:2,category:'APPROVAL',workflowCommand:'DATA_APPROVED',owner:'PAYROLL_CONTROLLER',
    });
  }

  if (['DATA_APPROVED','PAYROLL_FINALIZED'].includes(state)) {
    return result('PREPARE_PAYMENT','Prepare Payment','Open the approved payroll for Payment Instruction preparation.','operations',{
      actionable:true,tone:'info',priority:3,category:'PAYMENT',workflowCommand:'PAYMENT_INSTRUCTION_READY',owner:'PAYROLL_CONTROLLER',
    });
  }

  if (state === 'PAYMENT_INSTRUCTION_READY' || piStatus === 'PAYMENT_INSTRUCTION_READY') {
    if (hasPi) {
      return result('WAIT_PI_SUBMISSION','Waiting for PI Submission','Processor must submit the Payment Instruction for approval.','payments',{
        actionable:false,tone:'info',priority:5,category:'WAIT',owner:'PAYROLL_PROCESSOR',
      });
    }
    return result('WAIT_PI_GENERATION','Waiting for PI Generation','Processor must generate the Payment Instruction.','operations',{
      actionable:false,tone:'info',priority:5,category:'WAIT',owner:'PAYROLL_PROCESSOR',
    });
  }

  if (state === 'PAYMENT_APPROVAL_PENDING' || piStatus === 'PAYMENT_APPROVAL_PENDING') {
    if (canApprovePayment) {
      return result('REVIEW_APPROVE_PAYMENT','Review & Approve Payment','Payment Instruction is ready for Controller approval.','payments',{
        actionable:true,tone:'warning',priority:2,category:'APPROVAL',owner:'PAYROLL_CONTROLLER',
      });
    }
    return MONITOR.paymentApproval();
  }

  if (state === 'APPROVED_FOR_PAYMENT' || piStatus === 'APPROVED_FOR_PAYMENT') return MONITOR.paymentExecution();
  if (['DISBURSEMENT_PROCESSING','PAYMENT_CONFIRMED'].includes(state) || ['DISBURSEMENT_PROCESSING','PAYMENT_CONFIRMED'].includes(piStatus)) return MONITOR.payment();

  if (['PROOF_UPLOADED','RECONCILIATION'].includes(state) || ['PROOF_UPLOADED','RECONCILIATION'].includes(piStatus)
    || normalize(context.reconciliationStatus ?? context.recStatus) === 'PENDING') {
    return result('RECONCILE_PAYMENT','Reconcile Payment','Review payment evidence and complete reconciliation.','payments',{
      actionable:true,tone:'warning',priority:2,category:'RECONCILIATION',owner:'PAYROLL_CONTROLLER',
    });
  }

  if (state === 'PAYMENT_EXCEPTION' || piStatus === 'PAYMENT_EXCEPTION') {
    return result('REVIEW_PAYMENT_EXCEPTION','Review Payment Exception','Payment exception requires Controller review.','payments',{
      actionable:true,tone:'danger',priority:1,category:'EXCEPTION',owner:'PAYROLL_CONTROLLER',
    });
  }

  if (stage.stage === 'CLOSE') {
    return result(stage.isTerminal?'REVIEW_BILLING':'CONTINUE_CLOSE',stage.isTerminal?'Review Billing & Close':'Continue Closing',
      stage.isTerminal?'Payroll payment is complete. Review billing and closing status.':'Complete reconciliation before final closing.','billing',{
        actionable:true,tone:'info',priority:3,category:'CLOSE',owner:'PAYROLL_CONTROLLER',
      });
  }

  return MONITOR.payroll();
}

export function derivePayrollNextAction(context = {}) {
  const role = normalize(context.role);
  const stage = derivePayrollBusinessStage(context);

  if (!stage.knownState) {
    return {
      ...result('REVIEW_WORKFLOW_STATUS','Review Workflow Status','A technical state is not mapped to the business process.','operations',{
        actionable:role === 'SUPER_ADMIN',tone:'danger',priority:1,category:'EXCEPTION',owner:'SUPER_ADMIN',
      }),
      stage,
    };
  }

  const state = normalize(context.state ?? context.submissionState);
  if (['CANCELLED','REJECTED'].includes(state)) {
    return {
      ...result('VIEW_FINAL_STATUS',state === 'CANCELLED' ? 'Pay Run Cancelled' : 'Pay Run Rejected',
        'This Pay Run is terminal and has no remaining workflow action.','operations',{
          actionable:false,tone:'info',priority:5,category:'MONITOR',
        }),
      stage,
    };
  }
  if (stage.isTerminal) {
    return {
      ...result('VIEW_CLOSED_CYCLE','View Closed Cycle',
        'Payroll, billing and collection are complete for this cycle.','billing',{
          actionable:false,tone:'success',priority:5,category:'MONITOR',
        }),
      stage,
    };
  }

  let action;
  if (role === 'CLIENT_USER') action = clientAction(context, stage);
  else if (role === 'SUPER_ADMIN') {
    const state = normalize(context.state ?? context.submissionState);
    const controllerOwned = ['CONTROLLER_REVIEW','DATA_APPROVED','PAYROLL_FINALIZED','PAYMENT_APPROVAL_PENDING'].includes(state)
      || normalize(context.paymentInstructionStatus ?? context.piStatus) === 'PAYMENT_APPROVAL_PENDING';
    action = controllerOwned ? controllerAction(context, stage) : processorAction(context, stage);
  } else if (CONTROLLER_ROLES.has(role)) action = controllerAction(context, stage);
  else if (PROCESSOR_ROLES.has(role)) action = processorAction(context, stage);
  else {
    action = result('VIEW_STATUS','View Status','This role has no workflow action for the current payroll.','operations',{
      actionable:false,tone:'info',priority:5,category:'MONITOR',
    });
  }

  return { ...action, stage };
}

export function payrollNextActionCode(context = {}) {
  return derivePayrollNextAction(context).code;
}
