export type PaymentPanel='PI'|'DISBURSEMENT'|'FUNDING';
export type PaymentRole='PAYROLL_PROCESSOR'|'PAYROLL_CONTROLLER'|'SUPER_ADMIN'|string;

export function paymentPanel(value:string|null):PaymentPanel|null {
  if(value==='PI'||value==='DISBURSEMENT'||value==='FUNDING')return value;
  return null;
}

export function paymentDecisionSummary(rows:Array<{status:string}>,role:PaymentRole){
  const piReady=rows.filter(row=>row.status==='PAYMENT_INSTRUCTION_READY').length;
  const piAwaitingApproval=rows.filter(row=>row.status==='PAYMENT_APPROVAL_PENDING').length;
  const piApproved=rows.filter(row=>['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING'].includes(row.status)).length;
  const piNeedsReview=rows.filter(row=>row.status==='REVISION_REQUIRED').length;
  const isController=role==='PAYROLL_CONTROLLER';
  const isProcessor=role==='PAYROLL_PROCESSOR';
  return {
    piReady,piAwaitingApproval,piApproved,piNeedsReview,
    primaryCount:isController?piAwaitingApproval+piApproved:isProcessor?piReady+piNeedsReview:piAwaitingApproval+piReady+piNeedsReview,
    primaryLabel:isController?'PI perlu approval / payment':isProcessor?'PI perlu diproses':'Instruksi perlu perhatian',
  };
}

export function defaultPaymentPanel(rows:Array<{status:string}>,role:PaymentRole):PaymentPanel {
  const summary=paymentDecisionSummary(rows,role);
  if(summary.primaryCount>0)return 'PI';
  // When the PI queue has no actionable work, surface canonical DR approvals and
  // executions rather than expanding an empty PI table.
  return 'DISBURSEMENT';
}

export function canonicalActionRank(status:string,role:PaymentRole):number {
  if(role==='PAYROLL_CONTROLLER')return ({PENDING_APPROVAL:0,APPROVED:1,EXECUTING:2,RECONCILIATION_REQUIRED:2,PARTIALLY_SETTLED:3,FAILED:4,PROCESSING:5,READY:6} as Record<string,number>)[status]??10;
  if(role==='PAYROLL_PROCESSOR')return ({READY:0,FAILED:1,DRAFT:1,REJECTED:2,PENDING_APPROVAL:3,APPROVED:4,RECONCILIATION_REQUIRED:5} as Record<string,number>)[status]??10;
  return ({PENDING_APPROVAL:0,READY:1,APPROVED:2,RECONCILIATION_REQUIRED:3} as Record<string,number>)[status]??10;
}
export function canonicalNeedsAction(status:string,role:PaymentRole):boolean {
  if(role==='PAYROLL_CONTROLLER')return ['PENDING_APPROVAL','APPROVED','EXECUTING','PROCESSING','FAILED','RECONCILIATION_REQUIRED'].includes(status);
  if(role==='PAYROLL_PROCESSOR')return ['READY','FAILED'].includes(status);
  return false;
}
