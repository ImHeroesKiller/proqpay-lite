export function payrollPeriodMatches(row={},period){
  return !period || period==='ALL' || row.period===period || row.payment_period===period;
}

export function includeSubmissionForWorkspace(input={}){
  const focus=String(input.focusSubmissionId||'');
  if(focus) return String(input.row?.id||'')===focus;
  if(input.role==='PAYROLL_CONTROLLER' && input.nextAction?.actionable) return true;
  return payrollPeriodMatches(input.row||{},input.period);
}

const CONTROLLER_PAYMENT_STATUSES=new Set([
  'PAYMENT_APPROVAL_PENDING',
  'APPROVED_FOR_PAYMENT',
  'DISBURSEMENT_PROCESSING',
  'PROOF_UPLOADED',
  'RECONCILIATION',
  'PAYMENT_EXCEPTION',
]);

export function includePaymentForWorkspace(input={}){
  const focus=String(input.focusSubmissionId||'');
  if(focus) return String(input.row?.submission_id||'')===focus;
  if(input.role==='PAYROLL_CONTROLLER' && CONTROLLER_PAYMENT_STATUSES.has(String(input.row?.status||'').toUpperCase())) return true;
  return payrollPeriodMatches({period:input.row?.payroll_period,payment_period:input.row?.payment_period},input.period);
}

export function controllerActionScope(rows=[],role=''){
  if(role!=='PAYROLL_CONTROLLER') return rows;
  return rows.filter((row)=>row.nextAction?.actionable);
}
