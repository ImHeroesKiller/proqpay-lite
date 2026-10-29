export function workspaceStepCompletion(rows:Array<Record<string,unknown>>){
  if(!rows.length)return {PAYROLL:false,PAYMENT:false,CLOSE:false};
  const finalized=new Set(['PAYROLL_FINALIZED','CLIENT_APPROVAL_PENDING','CLIENT_APPROVED','PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED']);
  return {PAYROLL:rows.every(row=>finalized.has(String(row.state))),PAYMENT:rows.every(row=>row.payment_status==='COMPLETED'),CLOSE:rows.every(row=>row.period_status==='CLOSED')};
}
export function closeReadinessChecks(row:Record<string,unknown>){
  return [
    {label:'Input payroll final',ready:row.input_status==='READY'},
    {label:'Payroll completed',ready:row.state==='COMPLETED'},
    {label:'Payment Instruction completed',ready:row.payment_status==='COMPLETED'},
    {label:'Reconciliation matched',ready:row.reconciliation_status==='MATCHED'},
    {label:'Invoice diterbitkan',ready:['ISSUED','PARTIALLY_PAID','PAID'].includes(String(row.invoice_status||''))},
    {label:'Tidak ada critical exception',ready:row.blocking_count!=null&&Number(row.blocking_count)===0},
  ];
}
export const canRequestPeriodClose=(row:Record<string,unknown>)=>row.period_status==='OPEN'&&closeReadinessChecks(row).every(check=>check.ready);

export function invoicePaymentState(status:unknown,ar?:{balance?:unknown}){
  if(status==='PAID'||status==='PARTIALLY_PAID')return String(status);
  if(ar?.balance==null)return 'UNKNOWN';
  const balance=Number(ar.balance);return Number.isFinite(balance)?balance>0?'OUTSTANDING':'SETTLED':'UNKNOWN';
}
