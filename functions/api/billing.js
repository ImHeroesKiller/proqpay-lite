import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { billingSlaSchemaAvailable, materializeInvoiceSla } from './billing-sla-service.js';
import { validPaymentProofDate } from './payment-proof-validation.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'];
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
function orgId(env) { return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }
function text(value,max=500) { return String(value||'').trim().slice(0,max)||null; }
function integer(value,min=0,max=Number.MAX_SAFE_INTEGER) { const n=Number(value); return Number.isSafeInteger(n)&&n>=min&&n<=max?n:null; }
function processor(role) { return ['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role); }
function controller(role) { return ['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role); }
function hasPermission(actor,permission) { return Boolean(actor?.permissions?.includes(permission)); }
function canPrepareBilling(actor) { return processor(actor.role)&&hasPermission(actor,'billing:prepare'); }
function canApproveBilling(actor) { return controller(actor.role)&&hasPermission(actor,'billing:approve'); }
function canWriteAr(actor) { return controller(actor.role)&&hasPermission(actor,'ar:write'); }
async function recordAudit(database,organizationId,actor,action,entity,entityId,detail='') {
  await database.prepare(`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,timestamp)
    VALUES(?,?,?,?,?,?,?,?,${NOW})`).bind(`AUD-${crypto.randomUUID()}`,organizationId,actor.email,actor.role,action,String(detail||''),entity,entityId).run();
}
function parseJson(value) { try { return JSON.parse(value||'[]'); } catch { return []; } }
function parseObject(value) { try { const parsed=JSON.parse(value||'{}'); return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}; } catch { return {}; } }

export function addBusinessDaysUtc(start, days) {
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid business-day start date');
  let remaining = Math.max(0, Math.trunc(Number(days) || 0));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date;
}

function validate(body) {
  if (!body||typeof body!=='object'||Array.isArray(body)) return 'JSON object required';
  if (!body.action) return 'action wajib diisi';
  for (const key of ['clientId','paymentInstructionId','invoiceId','arId']) if (body[key]&&!ID.test(String(body[key]))) return `${key} tidak valid`;
  return null;
}
function clientFilter(actor,column) {
  const ids=actor.role==='CLIENT_USER'?(actor.clientIds||[]).map(String):[];
  if (actor.role!=='CLIENT_USER') return {sql:'',bindings:[]};
  if (!ids.length) return {sql:' AND 1=0',bindings:[]};
  return {sql:` AND ${column} IN (${ids.map(()=>'?').join(',')})`,bindings:ids};
}
function projectFilter(actor,column) {
  const ids=actor.role==='CLIENT_USER'&&Array.isArray(actor.projectIds)?actor.projectIds.map(String):[];
  if (actor.role!=='CLIENT_USER'||!ids.length) return {sql:'',bindings:[]};
  return {sql:` AND ${column} IN (${ids.map(()=>'?').join(',')})`,bindings:ids};
}
async function nextInvoiceSequence(database, organizationId, period) {
  const row = await d1First(database, `INSERT INTO invoice_sequences(org_id,period,next_number,updated_at)
    VALUES(?,?,2,${NOW})
    ON CONFLICT(org_id,period) DO UPDATE SET next_number=invoice_sequences.next_number+1,updated_at=${NOW}
    RETURNING next_number-1 AS number`, [organizationId, period]);
  return Number(row?.number || 1);
}

async function materializeLegacyAr(database, organizationId, invoice) {
  const existing = await d1First(database,'SELECT * FROM ar_monitor WHERE invoice_id=? AND org_id=? LIMIT 1',[invoice.id,organizationId]);
  if (existing) return { ar: existing, idempotentReplay: true };
  const base = invoice.issued_at || new Date().toISOString();
  const due = addBusinessDaysUtc(base, Number(invoice.payment_terms_days || 30));
  const dueDate = due.toISOString().slice(0,10), arId = `AR-${crypto.randomUUID()}`;
  await d1Batch(database,[
    {statement:`UPDATE invoices SET due_date=?,updated_at=${NOW} WHERE id=? AND org_id=?`,bindings:[dueDate,invoice.id,organizationId]},
    {statement:`INSERT INTO ar_monitor(id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,days_overdue,type,notes,updated_at)
      VALUES(?,?,?,?,?,?,?,0,?,'OUTSTANDING',?,0,'INVOICE','Billing package diterbitkan · legacy TOP weekdays-only',${NOW})`,
      bindings:[arId,organizationId,invoice.client_id,invoice.project_id,invoice.company,invoice.id,invoice.total_amount,invoice.total_amount,dueDate]},
  ]);
  return { ar: await d1First(database,'SELECT * FROM ar_monitor WHERE id=?',[arId]), dueDate };
}

export async function onRequest({request,env}) {
  if (request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if (!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:ROLES,mutating:request.method==='POST',methods:METHODS});
  if (authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'billing-ar',METHODS);
  if (limited) return limited;
  const respond=(data,status=200)=>secureJson(data,status,request,env,METHODS),requestId=crypto.randomUUID();
  if (!hasD1(env)) return respond({error:'Layanan data Billing & AR belum tersedia. Hubungi administrator.',code:'BILLING_DATA_UNAVAILABLE',requestId},503);
  const database=env.DB,actor=authorization.actor,organizationId=orgId(env);
  try {
    if (request.method==='GET') {
      const params=new URL(request.url).searchParams;
      const focusSubmissionId=params.get('submissionId');
      const pageLimit=Math.min(500,Math.max(1,Number.parseInt(params.get('limit')||'200',10)||200));
      const billableOffset=Math.max(0,Number.parseInt(params.get('billableOffset')||'0',10)||0);
      const invoiceOffset=Math.max(0,Number.parseInt(params.get('invoiceOffset')||'0',10)||0);
      const arOffset=Math.max(0,Number.parseInt(params.get('arOffset')||'0',10)||0);
      const submissionFilter=focusSubmissionId?{sql:' AND s.id=?',bindings:[focusSubmissionId]}:{sql:'',bindings:[]};
      const cs=clientFilter(actor,'id'),is=clientFilter(actor,'i.client_id'),as=clientFilter(actor,'ar.client_id'),
        ips=projectFilter(actor,'i.project_id'),aps=projectFilter(actor,'ar.project_id');
      const [clients,billablePayments,invoices,arItems,issuerProfile]=await Promise.all([
        d1All(database,`SELECT id,code,name,npwp,nitku,billing_address,billing_email,billing_cc_email,payment_terms_days,tax_status,
          purchase_order,billing_method,billing_rate,billing_admin_fee,billing_tax_rate,ar_payment_block_mode,ar_warning_days FROM clients
          WHERE org_id=?${cs.sql} ORDER BY name`,[organizationId,...cs.bindings]),
        actor.role==='CLIENT_USER'?Promise.resolve([]):d1All(database,`SELECT pi.id,pi.id AS instruction_number,pi.client_id,
          s.id AS submission_id,c.name AS company,c.name AS client_name,s.project_id,p.name AS project_name,s.period AS payroll_period,
          COALESCE(s.payment_period,s.period) AS payment_period,pi.expected_total,pi.expected_total AS payroll_total,
          (SELECT COUNT(*) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id) AS employee_count
          FROM payment_instructions pi JOIN clients c ON c.id=pi.client_id JOIN payroll_submissions s ON s.id=pi.submission_id
          LEFT JOIN projects p ON p.id=s.project_id WHERE pi.org_id=? AND pi.status='COMPLETED'
          AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.payment_instruction_id=pi.id)${submissionFilter.sql}
          ORDER BY pi.updated_at DESC,pi.id DESC LIMIT ? OFFSET ?`,[organizationId,...submissionFilter.bindings,pageLimit+1,billableOffset]),
        d1All(database,`SELECT i.*,s.id AS submission_id,c.name AS client_name,c.billing_email,c.billing_address,c.npwp,c.nitku,c.tax_status,
          c.tax_status AS client_tax_status,p.name AS project_name,
          COALESCE((SELECT json_group_array(json_object('action',x.action,'detail',x.detail,'username',x.username,'role',x.role,'timestamp',x.timestamp))
            FROM (SELECT al.action,al.detail,al.username,al.role,al.timestamp FROM audit_logs al WHERE al.org_id=i.org_id
              AND ((al.entity='invoice' AND al.entity_id=i.id) OR (al.entity='tax_invoice_file' AND al.entity_id=i.id))
              ORDER BY al.timestamp DESC LIMIT 100) x),'[]') AS audit_activity,
          EXISTS(SELECT 1 FROM audit_logs al WHERE al.org_id=i.org_id AND al.entity='tax_invoice_file' AND al.entity_id=i.id AND al.action='TAX_INVOICE_FILE_UPLOADED') AS tax_invoice_file_uploaded,
          COALESCE(ar.status,CASE WHEN i.status='ISSUED' THEN 'OUTSTANDING' ELSE NULL END) AS ar_status,
          COALESCE(ar.balance,i.total_amount) AS ar_balance,ar.id AS ar_id FROM invoices i JOIN clients c ON c.id=i.client_id
          LEFT JOIN payment_instructions pi_link ON pi_link.id=i.payment_instruction_id
          LEFT JOIN payroll_submissions s ON s.id=pi_link.submission_id
          LEFT JOIN projects p ON p.id=i.project_id LEFT JOIN ar_monitor ar ON ar.invoice_id=i.id
          WHERE i.org_id=?${is.sql}${actor.role==='CLIENT_USER'?" AND i.status IN ('ISSUED','PARTIALLY_PAID','PAID')":''}${ips.sql}${submissionFilter.sql}
          ORDER BY (i.issued_at IS NULL),i.issued_at DESC,i.updated_at DESC,i.id DESC LIMIT ? OFFSET ?`,[organizationId,...is.bindings,...ips.bindings,...submissionFilter.bindings,pageLimit+1,invoiceOffset]),
        d1All(database,`SELECT ar.*,i.invoice_number,i.total_amount,i.issued_at,c.name AS client_name,p.name AS project_name,
          c.ar_payment_block_mode,c.ar_warning_days,
          CASE WHEN ar.status NOT IN ('PAID','DISPUTED') AND date(ar.due_date)<date('now') THEN 'OVERDUE'
          WHEN ar.status='OUTSTANDING' AND date(ar.due_date)>=date('now') THEN 'NOT_DUE' ELSE ar.status END AS display_status,
          MAX(CAST(julianday('now')-julianday(ar.due_date) AS INTEGER),0) AS age_days,
          MAX(CAST(julianday('now')-julianday(ar.due_date) AS INTEGER),0) AS aging_days,
          CASE WHEN date(ar.due_date)>=date('now') THEN 'BELUM_JATUH_TEMPO'
          WHEN julianday('now')-julianday(ar.due_date)<=30 THEN '1-30' WHEN julianday('now')-julianday(ar.due_date)<=60 THEN '31-60'
          WHEN julianday('now')-julianday(ar.due_date)<=90 THEN '61-90' ELSE '>90' END AS aging_bucket,
          COALESCE((SELECT json_group_array(json_object('id',ap.id,'amount',ap.amount,'payment_date',ap.payment_date,
          'reference',ap.reference,'notes',ap.notes,'recorded_by',ap.recorded_by,'created_at',ap.created_at)) FROM ar_payments ap WHERE ap.ar_id=ar.id),'[]') AS payments,
          COALESCE((SELECT json_group_array(json_object('id',uc.id,'amount',uc.amount,'payment_date',uc.payment_date,
          'reference',uc.reference,'status',uc.status,'notes',uc.notes,'created_at',uc.created_at)) FROM unapplied_cash uc WHERE uc.ar_id=ar.id AND uc.status<>'VOID'),'[]') AS unapplied_cash,
          COALESCE((SELECT json_group_array(json_object('id',af.id,'note',af.note,'next_follow_up_at',af.next_follow_up_at,
          'created_by',af.created_by,'created_at',af.created_at)) FROM ar_follow_ups af WHERE af.ar_id=ar.id),'[]') AS follow_ups,
          COALESCE((SELECT json_group_array(json_object('action',x.action,'detail',x.detail,'username',x.username,'role',x.role,'timestamp',x.timestamp))
            FROM (SELECT al.action,al.detail,al.username,al.role,al.timestamp FROM audit_logs al WHERE al.org_id=ar.org_id
              AND al.entity='ar' AND al.entity_id=ar.id ORDER BY al.timestamp DESC LIMIT 100) x),'[]') AS audit_activity
          FROM ar_monitor ar JOIN invoices i ON i.id=ar.invoice_id JOIN clients c ON c.id=ar.client_id
          LEFT JOIN payment_instructions pi_link ON pi_link.id=i.payment_instruction_id
          LEFT JOIN payroll_submissions s ON s.id=pi_link.submission_id
          LEFT JOIN projects p ON p.id=ar.project_id WHERE ar.org_id=?${as.sql}${aps.sql}${submissionFilter.sql}
          ORDER BY ar.due_date DESC,ar.id DESC LIMIT ? OFFSET ?`,[organizationId,...as.bindings,...aps.bindings,...submissionFilter.bindings,pageLimit+1,arOffset]),
        d1First(database,`SELECT * FROM billing_issuer_profiles WHERE org_id=? LIMIT 1`,[organizationId]),
      ]);
      const billableTruncated=billablePayments.length>pageLimit;
      const invoiceTruncated=invoices.length>pageLimit;
      const arTruncated=arItems.length>pageLimit;
      const billablePage=billablePayments.slice(0,pageLimit);
      const invoicePage=invoices.slice(0,pageLimit);
      const arPage=arItems.slice(0,pageLimit);
      for (const invoice of invoicePage) {
        invoice.items=parseJson(invoice.items);
        invoice.audit_activity=parseJson(invoice.audit_activity);
        invoice.activity=invoice.audit_activity.map((entry)=>({...entry,type:'AUDIT',at:entry.timestamp}));
      }
      const clientGateSummary=new Map();
      const todayUtc=new Date();todayUtc.setUTCHours(0,0,0,0);
      for (const ar of arPage) {
        const key=String(ar.client_id||'');
        const warningDays=Math.max(0,Math.min(90,Number(ar.ar_warning_days||7)));
        const current=clientGateSummary.get(key)||{outstanding:0,overdue:0,dueSoon:0,mode:String(ar.ar_payment_block_mode||'OVERDUE'),warningDays};
        if (Number(ar.balance||0)>0 && String(ar.status||'')!=='PAID') {
          const balance=Number(ar.balance||0);
          current.outstanding += balance;
          if (ar.due_date) {
            const dueMs=new Date(String(ar.due_date)+'T00:00:00Z').getTime();
            if (dueMs < todayUtc.getTime()) current.overdue += balance;
            else if (dueMs <= todayUtc.getTime()+(warningDays*86_400_000)) current.dueSoon += balance;
          }
        }
        clientGateSummary.set(key,current);
      }
      for (const ar of arPage) {
        ar.payments=parseJson(ar.payments);
        ar.unapplied_cash=parseJson(ar.unapplied_cash);
        ar.follow_ups=parseJson(ar.follow_ups);
        ar.audit_activity=parseJson(ar.audit_activity);
        const paid=Number(ar.paid_amount||0),unapplied=ar.unapplied_cash.reduce((sum,row)=>sum+Number(row.amount||0),0),outstanding=Number(ar.balance||0),invoiceTotal=Number(ar.amount||0);
        ar.control={invoiceTotal,paid,unapplied,outstanding,agingDays:Number(ar.aging_days||0),appliedDifference:invoiceTotal-paid-outstanding};
        const gate=clientGateSummary.get(String(ar.client_id||''))||{outstanding:0,overdue:0,mode:'OVERDUE'};
        ar.payment_gate_state=gate.mode==='ANY_OUTSTANDING'&&gate.outstanding>0?'BLOCKED':
          gate.mode==='OVERDUE'&&gate.overdue>0?'BLOCKED':gate.dueSoon>0?'WARNING':'CLEAR';
        ar.client_outstanding=gate.outstanding;
        ar.client_overdue=gate.overdue;
        ar.activity=[
          ...ar.payments.map((row)=>({type:'PAYMENT',at:row.created_at||row.payment_date,reference:row.reference,amount:Number(row.amount||0),actor:row.recorded_by,notes:row.notes})),
          ...ar.unapplied_cash.map((row)=>({type:'UNAPPLIED_CASH',at:row.created_at||row.payment_date,reference:row.reference,amount:Number(row.amount||0),status:row.status,notes:row.notes})),
          ...ar.follow_ups.map((row)=>({type:'FOLLOW_UP',at:row.created_at,actor:row.created_by,notes:row.note,nextFollowUpAt:row.next_follow_up_at})),
          ...ar.audit_activity.map((entry)=>({...entry,type:'AUDIT',at:entry.timestamp})),
        ].sort((left,right)=>String(right.at||'').localeCompare(String(left.at||'')));
      }
      return respond({ok:true,clients,billablePayments:billablePage,invoices:invoicePage,arItems:arPage,issuerProfile:issuerProfile||null,
        meta:{
          billable:{offset:billableOffset,limit:pageLimit,returned:billablePage.length,nextOffset:billableTruncated?billableOffset+pageLimit:null,truncated:billableTruncated},
          invoices:{offset:invoiceOffset,limit:pageLimit,returned:invoicePage.length,nextOffset:invoiceTruncated?invoiceOffset+pageLimit:null,truncated:invoiceTruncated},
          ar:{offset:arOffset,limit:pageLimit,returned:arPage.length,nextOffset:arTruncated?arOffset+pageLimit:null,truncated:arTruncated},
        }});
    }
    const body=await request.json().catch(()=>null),error=validate(body);
    if (error) return respond({error},422);
    if (body.action==='UPDATE_BILLING_PROFILE') {
      if (!canPrepareBilling(actor)) return respond({error:'Aksi ini membutuhkan izin billing:prepare',code:'BILLING_PREPARE_PERMISSION_REQUIRED'},403);
      const method=String(body.billingMethod||''),terms=integer(body.paymentTermsDays,0,365),rate=Number(body.billingRate),
        admin=integer(body.billingAdminFee??body.adminFee,0),taxRate=Number(body.billingTaxRate??body.taxRate),taxStatus=String(body.taxStatus||'NON_PKP'),
        arBlockMode=String(body.arPaymentBlockMode||'OVERDUE'),arWarningDays=integer(body.arWarningDays??7,0,90);
      if (!['PER_EMPLOYEE','FIXED','PERCENTAGE_OF_PAYROLL'].includes(method)||terms===null||!Number.isFinite(rate)||rate<0||admin===null||!Number.isFinite(taxRate)||taxRate<0||taxRate>100||!['PKP','NON_PKP'].includes(taxStatus)||!['OFF','OVERDUE','ANY_OUTSTANDING'].includes(arBlockMode)||arWarningDays===null) return respond({error:'Nilai billing tidak valid'},422);
      const client=await d1First(database,`UPDATE clients SET npwp=?,nitku=?,billing_address=?,billing_email=?,billing_cc_email=?,payment_terms_days=?,
        tax_status=?,purchase_order=?,billing_method=?,billing_rate=?,billing_admin_fee=?,billing_tax_rate=?,ar_payment_block_mode=?,ar_warning_days=?
        WHERE id=? AND org_id=? RETURNING *`,
        [text(body.npwp,40),text(body.nitku,40),text(body.billingAddress,1000),text(body.billingEmail,254),text(body.billingCcEmail,254),terms,taxStatus,
        text(body.purchaseOrder,120),method,rate,admin,taxRate,arBlockMode,arWarningDays,body.clientId,organizationId]);
      if (!client) return respond({error:'Klien tidak ditemukan'},404);
      await recordAudit(database,organizationId,actor,'BILLING_PROFILE_UPDATED','client',client.id,JSON.stringify({billingMethod:method,paymentTermsDays:terms,taxStatus,arBlockMode,arWarningDays}));
      return respond({ok:true,client});
    }
    if (body.action==='UPDATE_ISSUER_PROFILE') {
      if (actor.role!=='SUPER_ADMIN') return respond({error:'Hanya Super Admin yang dapat mengubah profil penerbit invoice',code:'ISSUER_PROFILE_ADMIN_REQUIRED'},403);
      const legalName=text(body.legalName,180);
      if (!legalName) return respond({error:'Nama legal penerbit wajib diisi'},422);
      const profile=await d1First(database,`INSERT INTO billing_issuer_profiles
        (org_id,legal_name,address,npwp,email,phone,bank_name,bank_account_name,bank_account_no,payment_notes,updated_by,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,${NOW})
        ON CONFLICT(org_id) DO UPDATE SET legal_name=excluded.legal_name,address=excluded.address,npwp=excluded.npwp,
          email=excluded.email,phone=excluded.phone,bank_name=excluded.bank_name,bank_account_name=excluded.bank_account_name,
          bank_account_no=excluded.bank_account_no,payment_notes=excluded.payment_notes,updated_by=excluded.updated_by,updated_at=${NOW}
        RETURNING *`,[organizationId,legalName,text(body.address,1200),text(body.npwp,40),text(body.email,254),text(body.phone,60),
          text(body.bankName,120),text(body.bankAccountName,180),text(body.bankAccountNo,80),text(body.paymentNotes,500),actor.email]);
      await recordAudit(database,organizationId,actor,'BILLING_ISSUER_PROFILE_UPDATED','organization',organizationId,JSON.stringify({legalName,bankName:text(body.bankName,120)}));
      return respond({ok:true,issuerProfile:profile});
    }
    if (body.action==='GENERATE_INVOICE') {
      if (!canPrepareBilling(actor)) return respond({error:'Aksi ini membutuhkan role Payroll Processor dan izin billing:prepare',code:'BILLING_PREPARE_PERMISSION_REQUIRED'},403);
      const item=await d1First(database,`SELECT pi.*,c.code,c.name,c.billing_method,c.billing_rate,c.billing_admin_fee,c.billing_tax_rate,
        c.payment_terms_days,c.tax_status,c.purchase_order,s.period,s.payment_period,s.project_id,
        (SELECT COUNT(*) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id) AS employee_count
        FROM payment_instructions pi JOIN clients c ON c.id=pi.client_id JOIN payroll_submissions s ON s.id=pi.submission_id
        WHERE pi.id=? AND pi.org_id=? AND pi.status='COMPLETED' LIMIT 1`,[body.paymentInstructionId,organizationId]);
      if (!item) return respond({error:'Payment belum selesai atau tidak ditemukan'},409);
      const existing=await d1First(database,'SELECT * FROM invoices WHERE payment_instruction_id=? LIMIT 1',[item.id]);
      if (existing) return respond({ok:true,invoice:existing,idempotentReplay:true});
      const frozen=parseObject(item.billing_snapshot);
      const billingMethod=String(frozen.method||item.billing_method||'');
      const rate=Number(frozen.rate ?? item.billing_rate ?? 0),employees=Number(item.employee_count||0),payroll=Number(item.expected_total||0),
        serviceFee=billingMethod==='PER_EMPLOYEE'?Math.round(employees*rate):billingMethod==='PERCENTAGE_OF_PAYROLL'?Math.round(payroll*rate/100):Math.round(rate),
        adminFee=Number(frozen.adminFee ?? item.billing_admin_fee ?? 0),reimbursement=integer(body.reimbursement||0,0),discount=integer(body.discount||0,0);
      if (!['PER_EMPLOYEE','FIXED','PERCENTAGE_OF_PAYROLL'].includes(billingMethod)||reimbursement===null||discount===null||serviceFee+adminFee+reimbursement-discount<=0) return respond({error:'Billing rule belum lengkap atau nilai invoice tidak valid'},409);
      const taxStatus=String(frozen.taxStatus||item.tax_status||'NON_PKP');
      const subtotal=serviceFee+adminFee+reimbursement-discount,taxRate=taxStatus==='PKP'?Number(frozen.taxRate ?? item.billing_tax_rate ?? 0):0,
        taxAmount=Math.round(subtotal*taxRate/100),total=subtotal+taxAmount,period=String(item.payment_period||item.period||new Date().toISOString().slice(0,7));
      if (!PERIOD.test(period)) return respond({error:'Periode invoice tidak valid'},409);
      const sequence=await nextInvoiceSequence(database,organizationId,period);
      const invoiceNumber=`INV/${period.replace('-','')}/${String(item.code||'CLIENT').replace(/[^A-Z0-9]/gi,'').slice(0,10)}/${String(sequence).padStart(4,'0')}`,
        id=`INV-${crypto.randomUUID()}`,items=[{description:'Payroll service fee',quantity:billingMethod==='PER_EMPLOYEE'?employees:1,rate,amount:serviceFee},
        ...(adminFee?[{description:'Administration fee',quantity:1,rate:adminFee,amount:adminFee}]:[]),...(reimbursement?[{description:'Reimbursement',quantity:1,rate:reimbursement,amount:reimbursement}]:[]),
        ...(discount?[{description:'Discount',quantity:1,rate:-discount,amount:-discount}]:[])];
      try {
        const invoice=await d1First(database,`INSERT INTO invoices(id,org_id,client_id,project_id,payment_instruction_id,company,period,invoice_number,
          amount,subtotal,tax_rate,tax_amount,total_amount,status,items,tax_invoice_status,created_by,billing_snapshot,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?,${NOW}) RETURNING *`,[id,organizationId,item.client_id,item.project_id,item.id,item.name,period,
          invoiceNumber,subtotal,subtotal,taxRate,taxAmount,total,JSON.stringify(items),taxStatus==='PKP'?'PENDING':'NOT_REQUIRED',actor.email,
          item.billing_snapshot || JSON.stringify({ method:billingMethod,rate,adminFee,taxRate,taxStatus,paymentTermsDays:Number(item.payment_terms_days||0),purchaseOrder:item.purchase_order||null,legacyFallback:true })]);
        invoice.items=items;
        await recordAudit(database,organizationId,actor,'INVOICE_GENERATED','invoice',invoice.id,JSON.stringify({paymentInstructionId:item.id,invoiceNumber,totalAmount:total}));
        return respond({ok:true,invoice},201);
      } catch (insertError) {
        if (/payment_instruction_id|UNIQUE constraint failed: invoices\.payment_instruction_id/i.test(String(insertError?.message||insertError))) {
          const replay=await d1First(database,'SELECT * FROM invoices WHERE payment_instruction_id=? LIMIT 1',[item.id]);
          if (replay) return respond({ok:true,invoice:replay,idempotentReplay:true});
        }
        throw insertError;
      }
    }
    const transition=async(sql,bindings,message,auditAction,auditDetail='')=>{const invoice=await d1First(database,sql,bindings);if(!invoice)return respond({error:message},409);await recordAudit(database,organizationId,actor,auditAction,'invoice',invoice.id,auditDetail||JSON.stringify({status:invoice.status,taxInvoiceStatus:invoice.tax_invoice_status||null}));return respond({ok:true,invoice});};
    if (body.action==='SUBMIT_INVOICE') {
      if (!canPrepareBilling(actor)) return respond({error:'Aksi ini membutuhkan role Payroll Processor dan izin billing:prepare',code:'BILLING_PREPARE_PERMISSION_REQUIRED'},403);
      return transition(`UPDATE invoices SET status='UNDER_REVIEW',reviewed_at=${NOW},reviewed_by=?,updated_at=${NOW} WHERE id=? AND org_id=? AND status='DRAFT' RETURNING *`,[actor.email,body.invoiceId,organizationId],'Invoice tidak berada pada status DRAFT','INVOICE_SUBMITTED_FOR_REVIEW');
    }
    if (body.action==='APPROVE_INVOICE') {
      if (!canApproveBilling(actor)) return respond({error:'Aksi ini membutuhkan role Payroll Controller dan izin billing:approve',code:'BILLING_APPROVE_PERMISSION_REQUIRED'},403);
      return transition(`UPDATE invoices SET status='APPROVED',approved_at=${NOW},approved_by=?,updated_at=${NOW} WHERE id=? AND org_id=? AND status='UNDER_REVIEW' AND created_by<>? RETURNING *`,[actor.email,body.invoiceId,organizationId,actor.email],'Invoice belum diajukan atau maker tidak boleh menyetujui invoice sendiri','INVOICE_APPROVED');
    }
    if (body.action==='REVISE_INVOICE') {
      if (!canApproveBilling(actor)) return respond({error:'Aksi ini membutuhkan role Payroll Controller dan izin billing:approve',code:'BILLING_APPROVE_PERMISSION_REQUIRED'},403);
      return transition(`UPDATE invoices SET status='DRAFT',updated_at=${NOW},review_note=? WHERE id=? AND org_id=? AND status='UNDER_REVIEW' RETURNING *`,[text(body.reviewNote??body.note,1000),body.invoiceId,organizationId],'Invoice tidak dapat direvisi pada status ini','INVOICE_REVISION_REQUESTED',text(body.reviewNote??body.note,1000)||'');
    }
    if (body.action==='RECORD_TAX_INVOICE') {
      if (!canApproveBilling(actor)) return respond({error:'Aksi ini membutuhkan role Payroll Controller dan izin billing:approve',code:'BILLING_APPROVE_PERMISSION_REQUIRED'},403);
      const status=String(body.taxInvoiceStatus??body.status??'');
      if (!['SUBMITTED','APPROVED','REJECTED'].includes(status)) return respond({error:'Status faktur pajak tidak valid'},422);
      if (status==='APPROVED'&&(!text(body.taxInvoiceNumber,120)||!validPaymentProofDate(body.taxInvoiceDate))) return respond({error:'Nomor dan tanggal faktur pajak yang valid wajib diisi',code:'TAX_INVOICE_DATE_INVALID'},422);
      return transition(`UPDATE invoices SET tax_invoice_status=?,tax_invoice_number=?,tax_invoice_date=?,coretax_reference=?,updated_at=${NOW} WHERE id=? AND org_id=? AND status IN ('APPROVED','ISSUED','PARTIALLY_PAID','PAID') RETURNING *`,[status,text(body.taxInvoiceNumber,120),body.taxInvoiceDate||null,text(body.coretaxReference,160),body.invoiceId,organizationId],'Invoice belum disetujui','TAX_INVOICE_RECORDED',JSON.stringify({status,taxInvoiceNumber:text(body.taxInvoiceNumber,120),taxInvoiceDate:body.taxInvoiceDate||null}));
    }
    if (body.action==='ISSUE_INVOICE') {
      if (!canApproveBilling(actor)) return respond({error:'Aksi ini membutuhkan role Payroll Controller dan izin billing:approve',code:'BILLING_APPROVE_PERMISSION_REQUIRED'},403);
      let invoice=await d1First(database,`SELECT i.*,c.payment_terms_days,c.tax_status FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=? AND i.org_id=? LIMIT 1`,[body.invoiceId,organizationId]);
      if (!invoice) return respond({error:'Invoice tidak ditemukan'},404);
      if (invoice.status!=='ISSUED') {
        if (invoice.status!=='APPROVED') return respond({error:'Invoice belum disetujui'},409);
        if (invoice.tax_status==='PKP'&&invoice.tax_invoice_status!=='APPROVED') return respond({error:'Faktur pajak Coretax belum disetujui'},409);
        await d1Batch(database,[{statement:`UPDATE invoices SET status='ISSUED',issued_at=${NOW},due_date=NULL,updated_at=${NOW}
          WHERE id=? AND org_id=? AND status='APPROVED'`,bindings:[invoice.id,organizationId]}]);
        invoice=await d1First(database,`SELECT i.*,c.payment_terms_days,c.tax_status FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=? AND i.org_id=? LIMIT 1`,[body.invoiceId,organizationId]);
        await recordAudit(database,organizationId,actor,'INVOICE_ISSUED','invoice',invoice.id,JSON.stringify({invoiceNumber:invoice.invoice_number,totalAmount:Number(invoice.total_amount||0)}));
      }
      if (await billingSlaSchemaAvailable(database)) {
        const sla=await materializeInvoiceSla(database,organizationId,invoice.id);
        if (!sla.legacy) {
          if (sla.status>=400) return respond({error:sla.error,code:sla.code},sla.status);
          return respond({ok:true,invoiceId:invoice.id,arId:sla.ar?.id||null,slaPending:Boolean(sla.pending),slaStatus:sla.slaStatus||sla.invoice?.sla_status||null,
            missingTriggers:sla.evaluation?.missing||[],missingCalendarYears:sla.evaluation?.missingYears||[],idempotentReplay:Boolean(sla.idempotentReplay)});
        }
      }
      const legacy=await materializeLegacyAr(database,organizationId,invoice);
      return respond({ok:true,invoiceId:invoice.id,arId:legacy.ar?.id||null,idempotentReplay:Boolean(legacy.idempotentReplay),legacySla:true});
    }
    if (body.action==='RECORD_AR_PAYMENT') {
      if (!canWriteAr(actor)) return respond({error:'Aksi ini membutuhkan role Payroll Controller dan izin ar:write',code:'AR_WRITE_PERMISSION_REQUIRED'},403);
      const amount=integer(body.amount,1),paymentDate=body.paidAt??body.paymentDate,reference=text(body.reference,120);
      if (amount===null||!validPaymentProofDate(paymentDate)||!reference) return respond({error:'Data pembayaran AR tidak valid',code:'AR_PAYMENT_DATE_INVALID'},422);
      const ar=await d1First(database,'SELECT * FROM ar_monitor WHERE id=? AND org_id=? LIMIT 1',[body.arId,organizationId]);
      if (!ar) return respond({error:'AR tidak ditemukan'},404);
      const existingPayment=await d1First(database,'SELECT * FROM ar_payments WHERE ar_id=? AND reference=? LIMIT 1',[ar.id,reference]);
      const existingUnapplied=await d1First(database,"SELECT * FROM unapplied_cash WHERE ar_id=? AND reference=? AND status<>'VOID' LIMIT 1",[ar.id,reference]);
      const crossArReference=await d1First(database,`SELECT existing_ar.id AS ar_id,existing_ar.invoice_id
        FROM (
          SELECT ap.ar_id,ap.reference FROM ar_payments ap
          UNION ALL
          SELECT uc.ar_id,uc.reference FROM unapplied_cash uc WHERE uc.status<>'VOID'
        ) receipt
        JOIN ar_monitor existing_ar ON existing_ar.id=receipt.ar_id
        WHERE existing_ar.client_id=? AND existing_ar.id<>? AND receipt.reference=? LIMIT 1`,[ar.client_id,ar.id,reference]);
      if (crossArReference) return respond({
        error:'Reference pembayaran sudah digunakan pada piutang lain untuk klien yang sama',
        code:'AR_REFERENCE_ALREADY_ALLOCATED',
        existingArId:crossArReference.ar_id,
        existingInvoiceId:crossArReference.invoice_id,
      },409);
      if (existingPayment||existingUnapplied) {
        const current=await d1First(database,'SELECT * FROM ar_monitor WHERE id=? LIMIT 1',[ar.id]);
        return respond({ok:true,applied:Number(existingPayment?.amount||0),unapplied:Number(existingUnapplied?.amount||0),balance:Number(current?.balance||0),status:current?.status,idempotentReplay:true});
      }
      if (ar.status==='PAID' || Number(ar.balance||0)<=0) {
        const unappliedId=`UC-${crypto.randomUUID()}`;
        await d1Batch(database,[{statement:`INSERT INTO unapplied_cash(id,org_id,client_id,ar_id,invoice_id,amount,payment_date,reference,notes,status,recorded_by,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,'OPEN',?,${NOW})`,bindings:[unappliedId,organizationId,ar.client_id,ar.id,ar.invoice_id,amount,paymentDate,reference,text(body.notes,500),actor.email]}]);
        await recordAudit(database,organizationId,actor,'AR_PAYMENT_RECORDED','ar',ar.id,JSON.stringify({reference,paymentDate,amount,applied:0,unapplied:amount,balance:0}));
        return respond({ok:true,applied:0,unapplied:amount,balance:0,status:'PAID'});
      }
      const paymentId=`ARP-${crypto.randomUUID()}`,unappliedId=`UC-${crypto.randomUUID()}`;
      const operations=[
        {statement:`INSERT INTO ar_payments(id,ar_id,amount,payment_date,reference,notes,recorded_by)
          SELECT ?,id,MIN(?,balance),?,?,?,? FROM ar_monitor WHERE id=? AND org_id=? AND balance>0`,
          bindings:[paymentId,amount,paymentDate,reference,text(body.notes,500),actor.email,ar.id,organizationId]},
        {statement:`INSERT INTO unapplied_cash(id,org_id,client_id,ar_id,invoice_id,amount,payment_date,reference,notes,status,recorded_by,updated_at)
          SELECT ?,org_id,client_id,id,invoice_id,MAX(?-balance,0),?,?,?,'OPEN',?,${NOW}
          FROM ar_monitor WHERE id=? AND org_id=? AND ?>balance`,
          bindings:[unappliedId,amount,paymentDate,reference,text(body.notes,500),actor.email,ar.id,organizationId,amount]},
        {statement:`UPDATE ar_monitor SET
          paid_amount=MIN(amount,COALESCE((SELECT SUM(ap.amount) FROM ar_payments ap WHERE ap.ar_id=ar_monitor.id),0)),
          balance=MAX(0,amount-COALESCE((SELECT SUM(ap.amount) FROM ar_payments ap WHERE ap.ar_id=ar_monitor.id),0)),
          status=CASE WHEN amount-COALESCE((SELECT SUM(ap.amount) FROM ar_payments ap WHERE ap.ar_id=ar_monitor.id),0)<=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
          updated_at=${NOW} WHERE id=?`,bindings:[ar.id]},
        {statement:`UPDATE invoices SET status=CASE WHEN (SELECT balance FROM ar_monitor WHERE id=?)=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
          paid_at=CASE WHEN (SELECT balance FROM ar_monitor WHERE id=?)=0 THEN ? ELSE NULL END,updated_at=${NOW} WHERE id=?`,
          bindings:[ar.id,ar.id,paymentDate,ar.invoice_id]},
      ];
      try { await d1Batch(database,operations); }
      catch (paymentError) {
        if (/AR payment reference already allocated to another receivable/i.test(String(paymentError?.message||paymentError))) {
          return respond({error:'Reference pembayaran sudah digunakan pada piutang lain untuk klien yang sama',code:'AR_REFERENCE_ALREADY_ALLOCATED'},409);
        }
        if (/idx_ar_payment_reference|idx_unapplied_cash_reference|UNIQUE constraint/i.test(String(paymentError?.message||paymentError))) {
          const replayPayment=await d1First(database,'SELECT * FROM ar_payments WHERE ar_id=? AND reference=? LIMIT 1',[ar.id,reference]);
          const replayUnapplied=await d1First(database,"SELECT * FROM unapplied_cash WHERE ar_id=? AND reference=? AND status<>'VOID' LIMIT 1",[ar.id,reference]);
          const current=await d1First(database,'SELECT * FROM ar_monitor WHERE id=? LIMIT 1',[ar.id]);
          if (replayPayment||replayUnapplied) return respond({ok:true,applied:Number(replayPayment?.amount||0),unapplied:Number(replayUnapplied?.amount||0),balance:Number(current?.balance||0),status:current?.status,idempotentReplay:true});
        }
        throw paymentError;
      }
      const [recorded,unapplied,current]=await Promise.all([
        d1First(database,'SELECT amount FROM ar_payments WHERE id=?',[paymentId]),
        d1First(database,'SELECT amount FROM unapplied_cash WHERE id=?',[unappliedId]),
        d1First(database,'SELECT balance,status FROM ar_monitor WHERE id=?',[ar.id]),
      ]);
      await recordAudit(database,organizationId,actor,'AR_PAYMENT_RECORDED','ar',ar.id,JSON.stringify({reference,paymentDate,amount,applied:Number(recorded?.amount||0),unapplied:Number(unapplied?.amount||0),balance:Number(current?.balance||0)}));
      return respond({ok:true,applied:Number(recorded?.amount||0),unapplied:Number(unapplied?.amount||0),balance:Number(current?.balance||0),status:current?.status});
    }
    if (body.action==='FOLLOW_UP_AR') {
      if (!canWriteAr(actor)) return respond({error:'Aksi follow-up AR membutuhkan izin ar:write',code:'AR_WRITE_PERMISSION_REQUIRED'},403);
      const note=text(body.notes??body.note,1000);if (!note) return respond({error:'Catatan follow-up wajib diisi'},422);
      if (body.nextFollowUpAt && !validPaymentProofDate(body.nextFollowUpAt)) return respond({error:'Tanggal follow-up berikutnya tidak valid',code:'AR_FOLLOW_UP_DATE_INVALID'},422);
      const ar=await d1First(database,'SELECT * FROM ar_monitor WHERE id=? AND org_id=? LIMIT 1',[body.arId,organizationId]);if (!ar) return respond({error:'AR tidak ditemukan'},404);
      const status=body.disputed?'DISPUTED':ar.status;
      await d1Batch(database,[{statement:'INSERT INTO ar_follow_ups(id,ar_id,note,next_follow_up_at,created_by) VALUES(?,?,?,?,?)',bindings:[`ARF-${crypto.randomUUID()}`,body.arId,note,body.nextFollowUpAt||null,actor.email]},
        {statement:`UPDATE ar_monitor SET status=?,dispute_reason=?,last_follow_up_at=${NOW},next_follow_up_at=?,updated_at=${NOW} WHERE id=?`,bindings:[status,body.disputed?note:ar.dispute_reason,body.nextFollowUpAt||null,body.arId]}]);
      await recordAudit(database,organizationId,actor,'AR_FOLLOW_UP_RECORDED','ar',ar.id,JSON.stringify({status,nextFollowUpAt:body.nextFollowUpAt||null,disputed:Boolean(body.disputed),note}));
      return respond({ok:true,status});
    }
    return respond({error:'Action tidak dikenal'},422);
  } catch(error) { return respond(publicError(error,requestId),500); }
}
