export type QueueActionLike = {
  actionable?:boolean;
  category?:string;
};

export function payrollPeriodMatches(row:{period?:string|null;payment_period?:string|null},period?:string|null){
  return !period || period==='ALL' || row.period===period || row.payment_period===period;
}

export function includeSubmissionForWorkspace(input:{
  role:string;
  row:{id?:string|null;period?:string|null;payment_period?:string|null};
  period?:string|null;
  focusSubmissionId?:string|null;
  nextAction?:QueueActionLike|null;
}){
  const focus=String(input.focusSubmissionId||'');
  if(focus) return String(input.row.id||'')===focus;
  if(input.role==='PAYROLL_CONTROLLER' && input.nextAction?.actionable) return true;
  return payrollPeriodMatches(input.row,input.period);
}

const CONTROLLER_PAYMENT_STATUSES=new Set([
  'PAYMENT_APPROVAL_PENDING',
  'APPROVED_FOR_PAYMENT',
  'DISBURSEMENT_PROCESSING',
  'PROOF_UPLOADED',
  'RECONCILIATION',
  'PAYMENT_EXCEPTION',
]);

export function includePaymentForWorkspace(input:{
  role:string;
  row:{submission_id?:string|null;payroll_period?:string|null;payment_period?:string|null;status?:string|null};
  period?:string|null;
  focusSubmissionId?:string|null;
}){
  const focus=String(input.focusSubmissionId||'');
  if(focus) return String(input.row.submission_id||'')===focus;
  if(input.role==='PAYROLL_CONTROLLER' && CONTROLLER_PAYMENT_STATUSES.has(String(input.row.status||'').toUpperCase())) return true;
  return payrollPeriodMatches({period:input.row.payroll_period,payment_period:input.row.payment_period},input.period);
}

export function controllerActionScope<T extends {nextAction?:QueueActionLike|null}>(rows:T[],role:string){
  if(role!=='PAYROLL_CONTROLLER') return rows;
  return rows.filter((row)=>row.nextAction?.actionable);
}
