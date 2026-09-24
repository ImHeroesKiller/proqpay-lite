export type PaymentInstructionControl = {
  recipientCount: number;
  expectedRecipientCount: number;
  recipientBalanced: boolean;
  totalAmount: number;
  expectedTotal: number;
  balanced: boolean;
};

export type PaymentInstructionLine = {
  id: string;
  employee_id?: string | null;
  beneficiary_name?: string | null;
  bank_name?: string | null;
  bank_code?: string | null;
  account_last4?: string | null;
  masked_account?: string | null;
  amount: number;
  line_hash?: string | null;
};

export type PaymentInstructionApproval = {
  id: string;
  status: string;
  created_at: string;
  action_hash?: string | null;
  approver_email?: string | null;
  approver_user_id?: string | null;
};

export type PaymentInstructionActivity = {
  id: string;
  username?: string | null;
  role?: string | null;
  action: string;
  detail?: string | null;
  timestamp: string;
};

export type PaymentInstructionRecord = {
  id: string;
  submission_id?: string;
  document_no?: string | null;
  status: string;
  client_name?: string | null;
  project_name?: string | null;
  creator_email?: string | null;
  created_at: string;
  payroll_period?: string | null;
  payment_period?: string | null;
  content_hash?: string | null;
  rejection_reason?: string | null;
  rejected_by?: string | null;
};

export type PaymentInstructionDetail = {
  ok: true;
  paymentInstruction: PaymentInstructionRecord;
  lines: PaymentInstructionLine[];
  approvals: PaymentInstructionApproval[];
  activity: PaymentInstructionActivity[];
  control: PaymentInstructionControl;
};

const PAYMENT_STATUS_LABELS:Record<string,string>={
  PAYMENT_INSTRUCTION_READY:'Prepared',
  PAYMENT_APPROVAL_PENDING:'For Approval',
  APPROVED_FOR_PAYMENT:'Ready to Pay',
  DISBURSEMENT_PROCESSING:'Processing',
  PAYMENT_CONFIRMED:'Processing',
  PROOF_UPLOADED:'Reconcile',
  RECONCILIATION:'Reconcile',
  PAYMENT_EXCEPTION:'Action Required',
  REVISION_REQUIRED:'Revision Required',
  COMPLETED:'Completed',
  REJECTED:'Rejected',
};

const PAYMENT_ACTIVITY_LABELS:Record<string,string>={
  PAYMENT_INSTRUCTION_GENERATED:'Payment Instruction dibuat',
  PAYMENT_INSTRUCTION_SUBMITTED:'Dikirim untuk approval',
  PAYMENT_INSTRUCTION_APPROVED:'Payment Instruction disetujui',
  PAYMENT_INSTRUCTION_REJECTED:'Payment Instruction ditolak',
  PAYMENT_INSTRUCTION_BANK_SNAPSHOT_BACKFILLED:'Snapshot rekening legacy dipulihkan',
  PAYMENT_INSTRUCTION_LEGACY_RECOVERY:'Workflow legacy dipulihkan',
  PAYMENT_INSTRUCTION_ORPHAN_RECOVERY:'PI orphan dipulihkan',
  PAYMENT_INSTRUCTION_ORPHAN_REGENERATED:'PI orphan dibuat ulang',
  GATEWAY_PAYMENT_STARTED:'Eksekusi gateway dimulai',
  GATEWAY_EXECUTION_UNCERTAIN:'Status gateway belum pasti',
  GATEWAY_EXECUTION_FAILED:'Eksekusi gateway gagal',
  E2PAY_EXECUTION:'Eksekusi E2Pay',
  E2PAY_RECONCILED:'Status E2Pay disinkronkan',
  E2PAY_FAILED_ITEMS_RETRIED:'Beneficiary gagal dicoba ulang',
  E2PAY_EXECUTION_UNCERTAIN:'Status E2Pay belum pasti',
  E2PAY_EXECUTION_FAILED:'Eksekusi E2Pay gagal',
  PAYMENT_PROOF_UPLOADED:'Bukti pembayaran diunggah',
};

export function paymentBusinessLabel(status:string) {
  return PAYMENT_STATUS_LABELS[String(status||'')] || humanizePaymentToken(status);
}

export function paymentActivityLabel(action:string) {
  return PAYMENT_ACTIVITY_LABELS[String(action||'')] || humanizePaymentToken(action);
}

export function humanizePaymentToken(value:string) {
  const normalized=String(value||'-').replaceAll('_',' ').trim().toLowerCase();
  if (!normalized) return '-';
  return normalized.charAt(0).toUpperCase()+normalized.slice(1);
}

export function paymentInstructionIntegrity(detail:PaymentInstructionDetail|null|undefined) {
  const control=detail?.control;
  const hash=detail?.paymentInstruction?.content_hash;
  const totalBalanced=control?.balanced===true;
  const recipientBalanced=control?.recipientBalanced===true;
  const hashPresent=Boolean(hash);
  const valid=totalBalanced&&recipientBalanced&&hashPresent;
  return {
    valid,
    totalBalanced,
    recipientBalanced,
    hashPresent,
    approvalReady:valid&&detail?.paymentInstruction?.status==='PAYMENT_APPROVAL_PENDING',
  };
}

export function summarizePaymentBanks(lines:PaymentInstructionLine[]) {
  const summaries=new Map<string,{count:number;total:number}>();
  for (const line of lines) {
    const bank=String(line.bank_code||line.bank_name||'LAINNYA').toUpperCase();
    const current=summaries.get(bank)||{count:0,total:0};
    summaries.set(bank,{count:current.count+1,total:current.total+Number(line.amount||0)});
  }
  return [...summaries.entries()].sort((a,b)=>b[1].total-a[1].total);
}

export function filterPaymentInstructionLines(lines:PaymentInstructionLine[],query:string,bankFilter:string) {
  const needle=query.trim().toLowerCase();
  return lines.filter((line)=>{
    const bank=String(line.bank_code||line.bank_name||'LAINNYA').toUpperCase();
    const haystack=[line.beneficiary_name,line.employee_id,line.account_last4,bank].join(' ').toLowerCase();
    return (bankFilter==='ALL'||bank===bankFilter)&&(!needle||haystack.includes(needle));
  });
}

export function shortPaymentHash(value:string|null|undefined) {
  const hash=String(value||'');
  if (hash.length<=20) return hash;
  return `${hash.slice(0,12)}…${hash.slice(-8)}`;
}
