export type ReportType='payments'|'register'|'control'|'uploads'|'payslips'|'exceptions';

export type ReportValue=string|number|boolean|null|undefined|Record<string,unknown>|unknown[];
export type ReportRow=Record<string,ReportValue>;

export type PaymentReport={
  id:string;
  client_name?:string;
  project_name?:string;
  payroll_period?:string;
  payment_period?:string;
  arrears_periods?:string[];
  status:string;
  expected_total:number;
  paid_total?:number|null;
  payment_date?:string|null;
  reconciliation_status?:string;
  difference?:number;
  employee_count?:number;
  proof_id?:string;
  settlement_source?:'MANUAL_PROOF'|'PAYMENT_GATEWAY'|'CONFLICT'|'NONE';
  manual_proof_total?:number;
  gateway_total?:number;
};

export type ReportFacets={periods:string[];statuses:string[]};

export type ReportPageMeta={
  offset:number;
  limit:number;
  returned:number;
  nextOffset:number|null;
  truncated:boolean;
};

export type PayrollReportResponse={
  ok?:boolean;
  rows?:ReportRow[];
  facets?:ReportFacets;
  meta?:Partial<ReportPageMeta>;
  error?:string;
};

export type PaymentReportResponse={
  ok?:boolean;
  paymentReports?:PaymentReport[];
  paymentReportFacets?:ReportFacets;
  paymentReportsMeta?:Partial<ReportPageMeta>;
  error?:string;
};

export const REPORT_LABELS:Record<ReportType,string>={
  payments:'Laporan Pembayaran',
  register:'Register Payroll',
  control:'Laporan Kontrol',
  uploads:'Audit Upload',
  payslips:'Register Slip Gaji',
  exceptions:'Laporan Exception',
};

export const REPORT_MOBILE_FIELDS:Record<Exclude<ReportType,'payments'>,string[]>={
  register:['period','employee_id','gross_amount','deduction_amount','net_amount','state'],
  control:['period','employee_count','payroll_net','pi_total','reconciliation_difference','state'],
  uploads:['period','original_filename','accepted_row_count','source_total_net','status','uploaded_by'],
  payslips:['period','employee_id','net_amount','document_no','payment_status','reconciliation_status'],
  exceptions:['period','employee_id','severity','code','status','message'],
};

export const REPORT_COLUMNS:Record<Exclude<ReportType,'payments'>,string[]>={
  register:['period','client_name','project_name','employee_id','employee_name','gross_amount','deduction_amount','net_amount','run_type','state','source_batch_id','source_row_no'],
  control:['period','client_name','project_name','submission_id','employee_count','source_gross','source_deduction','source_net','payroll_gross','payroll_deduction','payroll_net','pi_total','proof_total','reconciliation_difference','state'],
  uploads:['uploaded_at','client_name','project_name','period','submission_id','original_filename','file_sha256','template_version','raw_row_count','accepted_row_count','source_total_gross','source_total_deduction','source_total_net','status','uploaded_by'],
  payslips:['period','client_name','project_name','employee_id','employee_name','run_type','gross_amount','deduction_amount','net_amount','document_no','payment_status','reconciliation_status','source_batch_id'],
  exceptions:['period','client_name','project_name','submission_id','employee_id','severity','code','status','message'],
};

const COLUMN_LABELS:Record<string,string>={
  period:'Periode',
  client_name:'Klien',
  project_name:'Project',
  employee_id:'ID Karyawan',
  employee_name:'Nama Karyawan',
  gross_amount:'Bruto',
  deduction_amount:'Potongan',
  net_amount:'Netto',
  run_type:'Tipe Payroll',
  state:'Status Payroll',
  source_batch_id:'Batch Sumber',
  source_row_no:'Baris Sumber',
  submission_id:'ID Pay Run',
  employee_count:'Karyawan',
  source_gross:'Bruto Sumber',
  source_deduction:'Potongan Sumber',
  source_net:'Netto Sumber',
  payroll_gross:'Bruto Payroll',
  payroll_deduction:'Potongan Payroll',
  payroll_net:'Netto Payroll',
  pi_total:'Total PI',
  proof_total:'Bukti Pembayaran',
  reconciliation_difference:'Selisih Rekonsiliasi',
  uploaded_at:'Waktu Upload',
  original_filename:'Nama File',
  file_sha256:'Fingerprint File',
  template_version:'Versi Template',
  raw_row_count:'Baris Mentah',
  accepted_row_count:'Baris Diterima',
  source_total_gross:'Bruto Sumber',
  source_total_deduction:'Potongan Sumber',
  source_total_net:'Netto Sumber',
  status:'Status',
  uploaded_by:'Diunggah Oleh',
  document_no:'Nomor Dokumen',
  payment_status:'Status Pembayaran',
  reconciliation_status:'Status Rekonsiliasi',
  severity:'Tingkat',
  code:'Kode',
  message:'Keterangan',
  payment_id:'ID Pembayaran',
  client:'Klien',
  project:'Project',
  payroll_period:'Periode Payroll',
  payment_period:'Periode Pembayaran',
  arrears:'Periode Tunggakan',
  employees:'Karyawan',
  expected_total:'Nilai Instruksi',
  settlement_source:'Sumber Settlement',
  manual_proof_total:'Bukti Manual',
  gateway_total:'Payment Gateway',
  paid_total:'Total Dibayar',
  payment_date:'Tanggal Pembayaran',
  reconciliation:'Rekonsiliasi',
  payment_difference:'Selisih Pembayaran',
  reconciliation_difference:'Selisih Rekonsiliasi',
};

const STATUS_LABELS:Record<string,string>={
  COMPLETED:'Selesai',
  MATCHED:'Sesuai',
  PAYMENT_EXCEPTION:'Perlu Tindak Lanjut',
  PROOF_UPLOADED:'Bukti Diunggah',
  CLIENT_APPROVED:'Disetujui Klien',
  CLIENT_APPROVAL_PENDING:'Menunggu Persetujuan Klien',
  PAYROLL_FINALIZED:'Payroll Final',
  PAYMENT_INSTRUCTION_READY:'PI Siap',
  PAYMENT_APPROVAL_PENDING:'Menunggu Persetujuan Pembayaran',
  APPROVED_FOR_PAYMENT:'Disetujui untuk Dibayar',
  DISBURSEMENT_PROCESSING:'Pembayaran Diproses',
  RECONCILIATION:'Rekonsiliasi',
  SUBMITTED:'Diajukan',
  DRAFT:'Draft',
  VALIDATED:'Tervalidasi',
  IMPORTED:'Terimpor',
  REJECTED:'Ditolak',
  RESOLVED:'Selesai Ditangani',
  ACCEPTED:'Diterima',
  AUTO_NORMALIZED:'Dinormalisasi Otomatis',
  CLIENT_ACTION_REQUIRED:'Perlu Tindakan Klien',
  MANUAL_PROOF:'Bukti Manual',
  PAYMENT_GATEWAY:'Payment Gateway',
  CONFLICT:'Konflik Settlement',
  SETTLEMENT_CONFLICT:'Konflik Settlement',
  NONE:'Belum Ada Settlement',
};

export function reportColumnLabel(key:string){
  return COLUMN_LABELS[key]||key.replaceAll('_',' ').replace(/\b\w/g,(char)=>char.toUpperCase());
}

export function reportStatusLabel(value:unknown){
  const key=String(value||'').trim();
  return STATUS_LABELS[key]||key.replaceAll('_',' ').replace(/\b\w/g,(char)=>char.toUpperCase())||'-';
}

export function reportStatusTone(value:unknown):'done'|'error'|'progress'|'neutral'{
  const key=String(value||'').toUpperCase();
  if(['COMPLETED','MATCHED','CLIENT_APPROVED','RESOLVED','ACCEPTED','IMPORTED','VALIDATED','AUTO_NORMALIZED'].includes(key)) return 'done';
  if(['PAYMENT_EXCEPTION','REJECTED','CLIENT_ACTION_REQUIRED','CONFLICT','SETTLEMENT_CONFLICT','CRITICAL','ERROR'].includes(key)) return 'error';
  if(!key||key==='NONE') return 'neutral';
  return 'progress';
}

export function isMoneyColumn(key:string){
  return /amount|gross|deduction|net|total|difference/.test(key);
}

export function reportPrimaryTitle(row:ReportRow){
  return String(row.employee_name||row.client_name||row.original_filename||row.submission_id||row.id||'Baris laporan');
}

export function reportSecondaryTitle(row:ReportRow){
  return String(row.project_name||row.employee_id||row.period||'');
}


export function isReportStatusColumn(key:string){
  return ['status','state','payment_status','reconciliation_status'].includes(key);
}

export function reportMobileFields(type:Exclude<ReportType,'payments'>,columns:string[]){
  return REPORT_MOBILE_FIELDS[type].filter((key)=>columns.includes(key));
}


const DATE_COLUMNS=new Set(['uploaded_at','payment_date','created_at','updated_at']);

export function reportFormatValue(key:string,value:unknown){
  if(value==null||value==='') return '-';
  if(isReportStatusColumn(key)||key==='settlement_source') return reportStatusLabel(value);
  if(typeof value==='number'&&isMoneyColumn(key)) return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
  if(DATE_COLUMNS.has(key)&&typeof value==='string'){
    const parsed=Date.parse(value);
    if(Number.isFinite(parsed)) return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium'}).format(new Date(parsed));
  }
  if(typeof value==='object') return JSON.stringify(value);
  return String(value);
}

export function reportExportRecord(row:Record<string,unknown>){
  return Object.fromEntries(Object.entries(row).map(([key,value])=>[reportColumnLabel(key),reportFormatValue(key,value)]));
}

export function isPayrollReportResponse(value:unknown):value is PayrollReportResponse{
  return Boolean(value&&typeof value==='object');
}

export function isPaymentReportResponse(value:unknown):value is PaymentReportResponse{
  return Boolean(value&&typeof value==='object');
}
