import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

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
function parseJson(value) { try { return JSON.parse(value||'[]'); } catch { return []; } }
const SLA_TRIGGERS=['PAYROLL_PAID','INVOICE_ISSUED','COMPLETE_DOCUMENT_RECEIVED','RECEIPT_ACKNOWLEDGED','BAST_SIGNED','CUSTOM'];
function addTerms(startDate,days,basis,holidays=new Set()) {
  const date=new Date(`${startDate}T00:00:00.000Z`); let counted=0;
  while(counted<days){date.setUTCDate(date.getUTCDate()+1);const iso=date.toISOString().slice(0,10),day=date.getUTCDay();if(basis==='CALENDAR_DAYS'||(day!==0&&day!==6&&!holidays.has(iso))) counted+=1;}
  return date.toISOString().slice(0,10);
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

export async function onRequest({request,env}) {
  if (request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if (!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:ROLES,mutating:request.method==='POST',methods:METHODS});
  if (authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'billing-ar',METHODS);
  if (limited) return limited;
  const respond=(data,status=200)=>secureJson(data,status,request,env,METHODS),requestId=crypto.randomUUID();
  if (!hasD1(env)) return respond({error:'Cloudflare D1 belum terhubung',requestId},503);
  const database=env.DB,actor=authorization.actor,organizationId=orgId(env);
  try {
    if (request.method==='GET') {
      const cs=clientFilter(actor,'id'),is=clientFilter(actor,'i.client_id'),as=clientFilter(actor,'ar.client_id');
      const [clients,billablePayments,invoices,arItems,holidays]=await Promise.all([
        d1All(database,`SELECT id,code,name,npwp,nitku,billing_address,billing_email,payment_terms_days,payment_terms_basis,sla_trigger,sla_trigger_label,sla_required_documents,tax_status,
          purchase_order,billing_method,billing_rate,billing_admin_fee,billing_tax_rate FROM clients
          WHERE org_id=?${cs.sql} ORDER BY name`,[organizationId,...cs.bindings]),
        actor.role==='CLIENT_USER'?Promise.resolve([]):d1All(database,`SELECT pi.id,pi.id AS instruction_number,pi.client_id,
          c.name AS company,c.name AS client_name,s.project_id,p.name AS project_name,s.period AS payroll_period,
          COALESCE(s.payment_period,s.period) AS payment_period,pi.expected_total,pi.expected_total AS payroll_total,
          (SELECT COUNT(*) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id) AS employee_count
          FROM payment_instructions pi JOIN clients c ON c.id=pi.client_id JOIN payroll_submissions s ON s.id=pi.submission_id
          LEFT JOIN projects p ON p.id=s.project_id WHERE pi.org_id=? AND pi.status='COMPLETED'
          AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.payment_instruction_id=pi.id)
          ORDER BY pi.updated_at DESC LIMIT 200`,[organizationId]),
        d1All(database,`SELECT i.*,c.name AS client_name,c.billing_email,c.billing_address,c.npwp,c.nitku,c.tax_status,
          c.tax_status AS client_tax_status,p.name AS project_name,
          EXISTS(SELECT 1 FROM audit_logs al WHERE al.org_id=i.org_id AND al.entity='tax_invoice_file' AND al.entity_id=i.id AND al.action='TAX_INVOICE_FILE_UPLOADED') AS tax_invoice_file_uploaded,
          COALESCE(ar.status,CASE WHEN i.status='ISSUED' THEN 'OUTSTANDING' ELSE NULL END) AS ar_status,
          COALESCE(ar.balance,i.total_amount) AS ar_balance,ar.id AS ar_id FROM invoices i JOIN clients c ON c.id=i.client_id
          LEFT JOIN projects p ON p.id=i.project_id LEFT JOIN ar_monitor ar ON ar.invoice_id=i.id
          WHERE i.org_id=?${is.sql}${actor.role==='CLIENT_USER'?" AND i.status IN ('ISSUED','PARTIALLY_PAID','PAID')":''}
          ORDER BY (i.issued_at IS NULL),i.issued_at DESC,i.updated_at DESC LIMIT 500`,[organizationId,...is.bindings]),
        d1All(database,`SELECT ar.*,i.invoice_number,i.total_amount,i.issued_at,i.sla_trigger,i.sla_status,c.name AS client_name,p.name AS project_name,
          CASE WHEN ar.due_date IS NULL THEN 'AWAITING_TRIGGER'
          WHEN ar.status NOT IN ('PAID','DISPUTED') AND date(ar.due_date)<date('now') THEN 'OVERDUE'
          WHEN ar.status='OUTSTANDING' AND date(ar.due_date)>=date('now') THEN 'NOT_DUE' ELSE ar.status END AS display_status,
          MAX(CAST(julianday('now')-julianday(ar.due_date) AS INTEGER),0) AS age_days,
          MAX(CAST(julianday('now')-julianday(ar.due_date) AS INTEGER),0) AS aging_days,
          CASE WHEN ar.due_date IS NULL THEN 'SLA_BELUM_MULAI'
          WHEN date(ar.due_date)>=date('now') THEN 'BELUM_JATUH_TEMPO'
          WHEN julianday('now')-julianday(ar.due_date)<=30 THEN '1-30' WHEN julianday('now')-julianday(ar.due_date)<=60 THEN '31-60'
          WHEN julianday('now')-julianday(ar.due_date)<=90 THEN '61-90' ELSE '>90' END AS aging_bucket,
          COALESCE((SELECT json_group_array(json_object('id',ap.id,'amount',ap.amount,'payment_date',ap.payment_date,
          'reference',ap.reference,'notes',ap.notes,'recorded_by',ap.recorded_by,'created_at',ap.created_at)) FROM ar_payments ap WHERE ap.ar_id=ar.id),'[]') AS payments,
          COALESCE((SELECT json_group_array(json_object('id',af.id,'note',af.note,'next_follow_up_at',af.next_follow_up_at,
          'created_by',af.created_by,'created_at',af.created_at)) FROM ar_follow_ups af WHERE af.ar_id=ar.id),'[]') AS follow_ups
          FROM ar_monitor ar JOIN invoices i ON i.id=ar.invoice_id JOIN clients c ON c.id=ar.client_id
          LEFT JOIN projects p ON p.id=ar.project_id WHERE ar.org_id=?${as.sql} ORDER BY ar.due_date DESC LIMIT 500`,[organizationId,...as.bindings]),
        actor.role==='CLIENT_USER'?Promise.resolve([]):d1All(database,'SELECT id,holiday_date,name FROM business_holidays WHERE org_id=? ORDER BY holiday_date DESC LIMIT 200',[organizationId]),
      ]);
      for (const invoice of invoices) invoice.items=parseJson(invoice.items);
      for (const ar of arItems) { ar.payments=parseJson(ar.payments); ar.follow_ups=parseJson(ar.follow_ups); }
      return respond({ok:true,clients,billablePayments,invoices,arItems,holidays});
    }
    const body=await request.json().catch(()=>null),error=validate(body);
    if (error) return respond({error},422);
    if (body.action==='UPDATE_BILLING_PROFILE') {
      if (!processor(actor.role)) return respond({error:'Hanya Super Admin atau Payroll Processor yang dapat mengubah profil billing'},403);
      const method=String(body.billingMethod||''),terms=integer(body.paymentTermsDays,0,365),rate=Number(body.billingRate),
        admin=integer(body.billingAdminFee??body.adminFee,0),taxRate=Number(body.billingTaxRate??body.taxRate),taxStatus=String(body.taxStatus||'NON_PKP'),
        termsBasis=String(body.paymentTermsBasis||'CALENDAR_DAYS'),slaTrigger=String(body.slaTrigger||'INVOICE_ISSUED'),requiredDocuments=Array.isArray(body.slaRequiredDocuments)?body.slaRequiredDocuments.map((item)=>String(item).trim()).filter(Boolean).slice(0,20):[];
      if (!['PER_EMPLOYEE','FIXED','PERCENTAGE_OF_PAYROLL'].includes(method)||terms===null||!Number.isFinite(rate)||rate<0||admin===null||!Number.isFinite(taxRate)||taxRate<0||taxRate>100||!['PKP','NON_PKP'].includes(taxStatus)||!['CALENDAR_DAYS','BUSINESS_DAYS'].includes(termsBasis)||!SLA_TRIGGERS.includes(slaTrigger)) return respond({error:'Nilai billing atau SLA tidak valid'},422);
      const client=await d1First(database,`UPDATE clients SET npwp=?,nitku=?,billing_address=?,billing_email=?,payment_terms_days=?,
        payment_terms_basis=?,sla_trigger=?,sla_trigger_label=?,sla_required_documents=?,tax_status=?,purchase_order=?,billing_method=?,billing_rate=?,billing_admin_fee=?,billing_tax_rate=? WHERE id=? AND org_id=? RETURNING *`,
        [text(body.npwp,40),text(body.nitku,40),text(body.billingAddress,1000),text(body.billingEmail,254),terms,termsBasis,slaTrigger,text(body.slaTriggerLabel,120),JSON.stringify(requiredDocuments),taxStatus,
        text(body.purchaseOrder,120),method,rate,admin,taxRate,body.clientId,organizationId]);
      return client?respond({ok:true,client}):respond({error:'Klien tidak ditemukan'},404);
    }
    if (body.action==='UPSERT_BUSINESS_HOLIDAY') {
      if (!controller(actor.role)) return respond({error:'Hanya Super Admin atau Payroll Controller yang dapat mengelola kalender hari kerja'},403);
      const holidayDate=String(body.holidayDate||''),name=text(body.name,120);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)||!name) return respond({error:'Tanggal dan nama hari libur wajib diisi'},422);
      const holiday=await d1First(database,`INSERT INTO business_holidays(id,org_id,holiday_date,name,created_by) VALUES(?,?,?,?,?)
        ON CONFLICT(org_id,holiday_date) DO UPDATE SET name=excluded.name RETURNING *`,[`HOL-${organizationId}-${holidayDate}`,organizationId,holidayDate,name,actor.email]);
      return respond({ok:true,holiday});
    }
    if (body.action==='GENERATE_INVOICE') {
      if (!processor(actor.role)) return respond({error:'Hanya Payroll Processor yang dapat menyiapkan invoice'},403);
      const item=await d1First(database,`SELECT pi.*,c.code,c.name,c.billing_method,c.billing_rate,c.billing_admin_fee,c.billing_tax_rate,
        c.payment_terms_days,c.tax_status,c.purchase_order,s.period,s.payment_period,s.project_id,
        (SELECT COUNT(*) FROM payment_instruction_lines WHERE payment_instruction_id=pi.id) AS employee_count
        FROM payment_instructions pi JOIN clients c ON c.id=pi.client_id JOIN payroll_submissions s ON s.id=pi.submission_id
        WHERE pi.id=? AND pi.org_id=? AND pi.status='COMPLETED' LIMIT 1`,[body.paymentInstructionId,organizationId]);
      if (!item) return respond({error:'Payment belum selesai atau tidak ditemukan'},409);
      const existing=await d1First(database,'SELECT * FROM invoices WHERE payment_instruction_id=? LIMIT 1',[item.id]);
      if (existing) return respond({ok:true,invoice:existing,idempotentReplay:true});
      const rate=Number(item.billing_rate||0),employees=Number(item.employee_count||0),payroll=Number(item.expected_total||0),
        serviceFee=item.billing_method==='PER_EMPLOYEE'?Math.round(employees*rate):item.billing_method==='PERCENTAGE_OF_PAYROLL'?Math.round(payroll*rate/100):Math.round(rate),
        adminFee=Number(item.billing_admin_fee||0),reimbursement=integer(body.reimbursement||0,0),discount=integer(body.discount||0,0);
      if (reimbursement===null||discount===null||serviceFee+adminFee+reimbursement-discount<=0) return respond({error:'Billing rule belum lengkap atau nilai invoice tidak valid'},409);
      const subtotal=serviceFee+adminFee+reimbursement-discount,taxRate=item.tax_status==='PKP'?Number(item.billing_tax_rate||0):0,
        taxAmount=Math.round(subtotal*taxRate/100),total=subtotal+taxAmount,period=String(item.payment_period||item.period||new Date().toISOString().slice(0,7));
      if (!PERIOD.test(period)) return respond({error:'Periode invoice tidak valid'},409);
      const sequence=await d1First(database,'SELECT COUNT(*)+1 AS number FROM invoices WHERE org_id=? AND period=?',[organizationId,period]);
      const invoiceNumber=`INV/${period.replace('-','')}/${String(item.code||'CLIENT').replace(/[^A-Z0-9]/gi,'').slice(0,10)}/${String(sequence?.number||1).padStart(4,'0')}`,
        id=`INV-${crypto.randomUUID()}`,items=[{description:'Payroll service fee',quantity:item.billing_method==='PER_EMPLOYEE'?employees:1,rate,amount:serviceFee},
        ...(adminFee?[{description:'Administration fee',quantity:1,rate:adminFee,amount:adminFee}]:[]),...(reimbursement?[{description:'Reimbursement',quantity:1,rate:reimbursement,amount:reimbursement}]:[]),
        ...(discount?[{description:'Discount',quantity:1,rate:-discount,amount:-discount}]:[])];
      const invoice=await d1First(database,`INSERT INTO invoices(id,org_id,client_id,project_id,payment_instruction_id,company,period,invoice_number,
        amount,subtotal,tax_rate,tax_amount,total_amount,status,items,tax_invoice_status,created_by,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,${NOW}) RETURNING *`,[id,organizationId,item.client_id,item.project_id,item.id,item.name,period,
        invoiceNumber,subtotal,subtotal,taxRate,taxAmount,total,JSON.stringify(items),item.tax_status==='PKP'?'PENDING':'NOT_REQUIRED',actor.email]);
      invoice.items=items; return respond({ok:true,invoice},201);
    }
    const transition=async(sql,bindings,message)=>{const invoice=await d1First(database,sql,bindings);return invoice?respond({ok:true,invoice}):respond({error:message},409);};
    if (body.action==='SUBMIT_INVOICE') {
      if (!processor(actor.role)) return respond({error:'Hanya Payroll Processor yang dapat mengajukan review'},403);
      return transition(`UPDATE invoices SET status='UNDER_REVIEW',reviewed_at=${NOW},reviewed_by=?,updated_at=${NOW} WHERE id=? AND org_id=? AND status='DRAFT' RETURNING *`,[actor.email,body.invoiceId,organizationId],'Invoice tidak berada pada status DRAFT');
    }
    if (body.action==='APPROVE_INVOICE') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat menyetujui invoice'},403);
      return transition(`UPDATE invoices SET status='APPROVED',approved_at=${NOW},approved_by=?,updated_at=${NOW} WHERE id=? AND org_id=? AND status='UNDER_REVIEW' AND (?='SUPER_ADMIN' OR created_by<>?) RETURNING *`,[actor.email,body.invoiceId,organizationId,actor.role,actor.email],'Invoice belum diajukan atau maker tidak boleh menyetujui invoice sendiri');
    }
    if (body.action==='REVISE_INVOICE') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat meminta revisi'},403);
      return transition(`UPDATE invoices SET status='DRAFT',updated_at=${NOW},review_note=? WHERE id=? AND org_id=? AND status='UNDER_REVIEW' RETURNING *`,[text(body.reviewNote??body.note,1000),body.invoiceId,organizationId],'Invoice tidak dapat direvisi pada status ini');
    }
    if (body.action==='RECORD_TAX_INVOICE') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat mencatat faktur pajak'},403);
      const status=String(body.taxInvoiceStatus??body.status??'');
      if (!['SUBMITTED','APPROVED','REJECTED'].includes(status)) return respond({error:'Status faktur pajak tidak valid'},422);
      if (status==='APPROVED'&&(!text(body.taxInvoiceNumber,120)||!/^\d{4}-\d{2}-\d{2}$/.test(String(body.taxInvoiceDate||'')))) return respond({error:'Nomor dan tanggal faktur pajak wajib diisi'},422);
      return transition(`UPDATE invoices SET tax_invoice_status=?,tax_invoice_number=?,tax_invoice_date=?,coretax_reference=?,updated_at=${NOW} WHERE id=? AND org_id=? AND status IN ('APPROVED','ISSUED','PARTIALLY_PAID','PAID') RETURNING *`,[status,text(body.taxInvoiceNumber,120),body.taxInvoiceDate||null,text(body.coretaxReference,160),body.invoiceId,organizationId],'Invoice belum disetujui');
    }
    if (body.action==='ISSUE_INVOICE') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat menerbitkan invoice'},403);
      const invoice=await d1First(database,`SELECT i.*,c.payment_terms_days,c.payment_terms_basis,c.sla_trigger,c.tax_status FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=? AND i.org_id=? LIMIT 1`,[body.invoiceId,organizationId]);
      if (!invoice||invoice.status!=='APPROVED') return respond({error:'Invoice belum disetujui'},409);
      if (invoice.tax_status==='PKP'&&invoice.tax_invoice_status!=='APPROVED') return respond({error:'Faktur pajak Coretax belum disetujui'},409);
      const issuedDate=new Date().toISOString().slice(0,10),autoStart=invoice.sla_trigger==='INVOICE_ISSUED';
      const holidays=autoStart&&invoice.payment_terms_basis==='BUSINESS_DAYS'?new Set((await d1All(database,'SELECT holiday_date FROM business_holidays WHERE org_id=?',[organizationId])).map((row)=>row.holiday_date)):new Set();
      const dueDate=autoStart?addTerms(issuedDate,Number(invoice.payment_terms_days||30),invoice.payment_terms_basis,holidays):null,arId=`AR-${crypto.randomUUID()}`;
      await d1Batch(database,[{statement:`UPDATE invoices SET status='ISSUED',issued_at=${NOW},sent_at=${NOW},due_date=?,sla_trigger=?,sla_trigger_date=?,sla_status=?,updated_at=${NOW} WHERE id=?`,bindings:[dueDate,invoice.sla_trigger,autoStart?issuedDate:null,autoStart?'RUNNING':'NOT_STARTED',invoice.id]},
        {statement:`INSERT INTO ar_monitor(id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,days_overdue,type,notes,updated_at) VALUES(?,?,?,?,?,?,?,0,?,'OUTSTANDING',?,0,'INVOICE','Billing package diterbitkan',${NOW})`,bindings:[arId,organizationId,invoice.client_id,invoice.project_id,invoice.company,invoice.id,invoice.total_amount,invoice.total_amount,dueDate]}]);
      return respond({ok:true,invoiceId:invoice.id,arId});
    }
    if (body.action==='START_INVOICE_SLA') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat memulai SLA invoice'},403);
      const triggerDate=String(body.triggerDate||''),trigger=String(body.slaTrigger||'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(triggerDate)||!SLA_TRIGGERS.includes(trigger)) return respond({error:'Trigger dan tanggal SLA tidak valid'},422);
      const invoice=await d1First(database,`SELECT i.*,c.payment_terms_days,c.payment_terms_basis,c.sla_trigger FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=? AND i.org_id=? LIMIT 1`,[body.invoiceId,organizationId]);
      if(!invoice||!['ISSUED','PARTIALLY_PAID'].includes(invoice.status)||invoice.sla_status!=='NOT_STARTED') return respond({error:'Invoice tidak siap memulai SLA'},409);
      if(trigger!==invoice.sla_trigger) return respond({error:'Trigger tidak sesuai kontrak klien'},409);
      const holidays=invoice.payment_terms_basis==='BUSINESS_DAYS'?new Set((await d1All(database,'SELECT holiday_date FROM business_holidays WHERE org_id=?',[organizationId])).map((row)=>row.holiday_date)):new Set();
      const dueDate=addTerms(triggerDate,Number(invoice.payment_terms_days||30),invoice.payment_terms_basis,holidays);
      await d1Batch(database,[{statement:`UPDATE invoices SET sla_trigger_date=?,sla_status='RUNNING',sla_evidence_notes=?,due_date=?,updated_at=${NOW} WHERE id=?`,bindings:[triggerDate,text(body.notes,1000),dueDate,invoice.id]},
        {statement:`UPDATE ar_monitor SET due_date=?,notes=?,updated_at=${NOW} WHERE invoice_id=?`,bindings:[dueDate,`SLA ${trigger} dimulai ${triggerDate}`,invoice.id]},
        {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,'INVOICE_SLA_STARTED',?,'invoice',?)`,bindings:[`AUD-${crypto.randomUUID()}`,organizationId,actor.email,actor.role,JSON.stringify({trigger,triggerDate,dueDate,notes:text(body.notes,1000)}),invoice.id]}]);
      return respond({ok:true,dueDate,trigger});
    }
    if (body.action==='RECORD_AR_PAYMENT') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat mencatat pembayaran AR'},403);
      const amount=integer(body.amount,1),paymentDate=body.paidAt??body.paymentDate;
      if (amount===null||!/^\d{4}-\d{2}-\d{2}$/.test(String(paymentDate||''))||!text(body.reference,120)) return respond({error:'Data pembayaran AR tidak valid'},422);
      const ar=await d1First(database,'SELECT * FROM ar_monitor WHERE id=? AND org_id=? LIMIT 1',[body.arId,organizationId]);
      if (!ar||ar.status==='PAID') return respond({error:'AR tidak ditemukan atau sudah lunas'},409);
      const applied=Math.min(amount,Number(ar.balance||0)),paid=Number(ar.paid_amount||0)+applied,balance=Number(ar.amount||0)-paid,status=balance===0?'PAID':'PARTIAL_PAID';
      await d1Batch(database,[{statement:'INSERT INTO ar_payments(id,ar_id,amount,payment_date,reference,notes,recorded_by) VALUES(?,?,?,?,?,?,?)',bindings:[`ARP-${crypto.randomUUID()}`,ar.id,applied,paymentDate,text(body.reference,120),text(body.notes,500),actor.email]},
        {statement:`UPDATE ar_monitor SET paid_amount=?,balance=?,status=?,updated_at=${NOW} WHERE id=?`,bindings:[paid,balance,status,ar.id]},
        {statement:`UPDATE invoices SET status=?,paid_at=?,sla_status=CASE WHEN ?='PAID' THEN 'COMPLETED' ELSE sla_status END,updated_at=${NOW} WHERE id=?`,bindings:[status==='PAID'?'PAID':'PARTIAL_PAID',status==='PAID'?paymentDate:null,status,ar.invoice_id]}]);
      return respond({ok:true,applied,balance,status});
    }
    if (body.action==='FOLLOW_UP_AR') {
      if (!processor(actor.role)&&!controller(actor.role)) return respond({error:'Role tidak dapat melakukan follow-up AR'},403);
      const note=text(body.notes??body.note,1000);if (!note) return respond({error:'Catatan follow-up wajib diisi'},422);
      const ar=await d1First(database,'SELECT * FROM ar_monitor WHERE id=? AND org_id=? LIMIT 1',[body.arId,organizationId]);if (!ar) return respond({error:'AR tidak ditemukan'},404);
      const status=body.disputed?'DISPUTED':ar.status;
      await d1Batch(database,[{statement:'INSERT INTO ar_follow_ups(id,ar_id,note,next_follow_up_at,created_by) VALUES(?,?,?,?,?)',bindings:[`ARF-${crypto.randomUUID()}`,body.arId,note,body.nextFollowUpAt||null,actor.email]},
        {statement:`UPDATE ar_monitor SET status=?,dispute_reason=?,last_follow_up_at=${NOW},next_follow_up_at=?,updated_at=${NOW} WHERE id=?`,bindings:[status,body.disputed?note:ar.dispute_reason,body.nextFollowUpAt||null,body.arId]}]);
      return respond({ok:true,status});
    }
    return respond({error:'Action tidak dikenal'},422);
  } catch(error) { return respond(publicError(error,requestId),500); }
}
