import { neon } from '@neondatabase/serverless';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'];
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function databaseUrl(env) { return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null; }
function orgId(env) { return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }
function text(value, max=500) { return String(value || '').trim().slice(0,max) || null; }
function integer(value, min=0, max=Number.MAX_SAFE_INTEGER) { const n=Number(value); return Number.isSafeInteger(n) && n>=min && n<=max ? n : null; }
function clientAllowed(actor, clientId) { return actor.role !== 'CLIENT_USER' || (actor.clientIds || []).map(String).includes(String(clientId)); }
function processor(role) { return ['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(role); }
function controller(role) { return ['SUPER_ADMIN','PAYROLL_CONTROLLER'].includes(role); }

async function prepare(sql) {
  const statements = [
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS npwp TEXT`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS nitku TEXT`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_address TEXT`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_email TEXT`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_terms_days INT NOT NULL DEFAULT 30`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_status TEXT NOT NULL DEFAULT 'NON_PKP'`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS purchase_order TEXT`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_method TEXT NOT NULL DEFAULT 'PER_EMPLOYEE'`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_rate NUMERIC(18,4) NOT NULL DEFAULT 0`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_admin_fee BIGINT NOT NULL DEFAULT 0`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_tax_rate NUMERIC(8,4) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id)`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_instruction_id TEXT REFERENCES payment_instructions(id)`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal BIGINT DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4) DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_by TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS review_note TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved_by TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_invoice_status TEXT DEFAULT 'PENDING'`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_invoice_number TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_invoice_date DATE`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS coretax_reference TEXT`,
    `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id)`,
    `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id)`,
    `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS paid_amount BIGINT DEFAULT 0`,
    `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS balance BIGINT DEFAULT 0`,
    `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ`,
    `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS next_follow_up_at DATE`,
    `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS dispute_reason TEXT`,
    `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payment_instruction ON invoices(payment_instruction_id) WHERE payment_instruction_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_number_org ON invoices(org_id, invoice_number) WHERE invoice_number IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS ar_payments (
      id TEXT PRIMARY KEY, ar_id TEXT NOT NULL REFERENCES ar_monitor(id), amount BIGINT NOT NULL,
      payment_date DATE NOT NULL, reference TEXT NOT NULL, notes TEXT, recorded_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ar_follow_ups (
      id TEXT PRIMARY KEY, ar_id TEXT NOT NULL REFERENCES ar_monitor(id), note TEXT NOT NULL,
      next_follow_up_at DATE, created_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
  ];
  for (const statement of statements) await sql.query(statement);
}

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'JSON object required';
  if (!body.action) return 'action wajib diisi';
  const idFields = ['clientId','paymentInstructionId','invoiceId','arId'];
  for (const key of idFields) if (body[key] && !ID.test(String(body[key]))) return `${key} tidak valid`;
  return null;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET','POST'].includes(request.method)) return secureJson({ error:'Method not allowed' },405,request,env,METHODS);
  const authorization = await authorize(request, env, { roles:ROLES, mutating:request.method==='POST', methods:METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request,env,authorization.actor,'billing-ar',METHODS);
  if (limited) return limited;
  const respond=(data,status=200)=>secureJson(data,status,request,env,METHODS);
  const requestId=crypto.randomUUID();
  const url=databaseUrl(env);
  if (!url) return respond({error:'Database belum terhubung',requestId},503);
  const sql=neon(url), actor=authorization.actor, organizationId=orgId(env);
  try {
    await prepare(sql);
    if (request.method === 'GET') {
      const scope=(actor.clientIds||[]).map(String).join(',');
      const [clients,payments,invoices,ars] = await Promise.all([
        sql`SELECT id,code,name,npwp,nitku,billing_address,billing_email,payment_terms_days,tax_status,
          purchase_order,billing_method,billing_rate,billing_admin_fee,billing_tax_rate
          FROM clients WHERE org_id=${organizationId}
            AND (${actor.role!=='CLIENT_USER'} OR id=ANY(string_to_array(${scope},','))) ORDER BY name`,
        sql`SELECT pi.id,pi.id AS instruction_number,pi.client_id,c.name AS company,c.name AS client_name,s.project_id,p.name AS project_name,
          s.period AS payroll_period,COALESCE(s.payment_period,s.period) AS payment_period,
          pi.expected_total,pi.expected_total AS payroll_total,(SELECT COUNT(*)::int FROM payment_instruction_lines pil WHERE pil.payment_instruction_id=pi.id) AS employee_count
          FROM payment_instructions pi JOIN clients c ON c.id=pi.client_id
          LEFT JOIN payroll_submissions s ON s.id=pi.submission_id LEFT JOIN projects p ON p.id=s.project_id
          WHERE pi.org_id=${organizationId} AND pi.status='COMPLETED'
            AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.payment_instruction_id=pi.id)
            AND (${actor.role!=='CLIENT_USER'})
            AND (${actor.role!=='CLIENT_USER'} OR pi.client_id=ANY(string_to_array(${scope},',')))
          ORDER BY pi.updated_at DESC LIMIT 200`,
        sql`SELECT i.*,c.name AS client_name,c.billing_email,c.billing_address,c.npwp,c.nitku,c.tax_status,c.tax_status AS client_tax_status,p.name AS project_name,
          COALESCE(ar.status,CASE WHEN i.status='ISSUED' THEN 'OUTSTANDING' ELSE NULL END) AS ar_status,
          COALESCE(ar.balance,i.total_amount)::bigint AS ar_balance,ar.id AS ar_id
          FROM invoices i JOIN clients c ON c.id=i.client_id LEFT JOIN projects p ON p.id=i.project_id
          LEFT JOIN ar_monitor ar ON ar.invoice_id=i.id
          WHERE i.org_id=${organizationId}
            AND (${actor.role!=='CLIENT_USER'} OR (i.client_id=ANY(string_to_array(${scope},',')) AND i.status IN ('ISSUED','PARTIALLY_PAID','PAID')))
          ORDER BY i.issued_at DESC NULLS LAST,i.updated_at DESC NULLS LAST LIMIT 500`,
        sql`SELECT ar.*,i.invoice_number,i.total_amount,i.issued_at,c.name AS client_name,p.name AS project_name,
          CASE WHEN ar.status NOT IN ('PAID','DISPUTED') AND ar.due_date::date<CURRENT_DATE THEN 'OVERDUE'
            WHEN ar.status='OUTSTANDING' AND ar.due_date::date>=CURRENT_DATE THEN 'NOT_DUE' ELSE ar.status END AS display_status,
          GREATEST(CURRENT_DATE-ar.due_date::date,0)::int AS age_days,
          GREATEST(CURRENT_DATE-ar.due_date::date,0)::int AS aging_days,
          CASE WHEN ar.due_date::date>=CURRENT_DATE THEN 'BELUM_JATUH_TEMPO'
            WHEN CURRENT_DATE-ar.due_date::date<=30 THEN '1-30'
            WHEN CURRENT_DATE-ar.due_date::date<=60 THEN '31-60'
            WHEN CURRENT_DATE-ar.due_date::date<=90 THEN '61-90' ELSE '>90' END AS aging_bucket,
          (SELECT COALESCE(json_agg(row_to_json(ap) ORDER BY ap.payment_date DESC),'[]'::json) FROM ar_payments ap WHERE ap.ar_id=ar.id) AS payments,
          (SELECT COALESCE(json_agg(row_to_json(af) ORDER BY af.created_at DESC),'[]'::json) FROM ar_follow_ups af WHERE af.ar_id=ar.id) AS follow_ups
          FROM ar_monitor ar JOIN invoices i ON i.id=ar.invoice_id JOIN clients c ON c.id=ar.client_id
          LEFT JOIN projects p ON p.id=ar.project_id WHERE ar.org_id=${organizationId}
            AND (${actor.role!=='CLIENT_USER'} OR ar.client_id=ANY(string_to_array(${scope},',')))
          ORDER BY ar.due_date DESC LIMIT 500`,
      ]);
      return respond({ok:true,clients,billablePayments:payments,invoices,arItems:ars});
    }

    const body=await request.json().catch(()=>null);
    const error=validate(body);
    if (error) return respond({error},422);

    if (body.action==='UPDATE_BILLING_PROFILE') {
      if (!processor(actor.role)) return respond({error:'Hanya Super Admin atau Payroll Processor yang dapat mengubah profil billing'},403);
      const method=String(body.billingMethod||'');
      if (!['PER_EMPLOYEE','FIXED','PERCENTAGE_OF_PAYROLL'].includes(method)) return respond({error:'Metode billing tidak valid'},422);
      const terms=integer(body.paymentTermsDays,0,365), rate=Number(body.billingRate), admin=integer(body.billingAdminFee ?? body.adminFee,0), taxRate=Number(body.billingTaxRate ?? body.taxRate);
      if (terms===null || !Number.isFinite(rate) || rate<0 || admin===null || !Number.isFinite(taxRate) || taxRate<0 || taxRate>100) return respond({error:'Nilai billing tidak valid'},422);
      const taxStatus=String(body.taxStatus||'NON_PKP');
      if (!['PKP','NON_PKP'].includes(taxStatus)) return respond({error:'Status pajak tidak valid'},422);
      const rows=await sql`UPDATE clients SET npwp=${text(body.npwp,40)},nitku=${text(body.nitku,40)},
        billing_address=${text(body.billingAddress,1000)},billing_email=${text(body.billingEmail,254)},
        payment_terms_days=${terms},tax_status=${taxStatus},purchase_order=${text(body.purchaseOrder,120)},
        billing_method=${method},billing_rate=${rate},billing_admin_fee=${admin},billing_tax_rate=${taxRate}
        WHERE id=${body.clientId} AND org_id=${organizationId} RETURNING *`;
      if (!rows.length) return respond({error:'Klien tidak ditemukan'},404);
      return respond({ok:true,client:rows[0]});
    }

    if (body.action==='GENERATE_INVOICE') {
      if (!processor(actor.role)) return respond({error:'Hanya Payroll Processor yang dapat menyiapkan invoice'},403);
      const source=await sql`SELECT pi.*,c.code,c.name,c.billing_method,c.billing_rate,c.billing_admin_fee,c.billing_tax_rate,
        c.payment_terms_days,c.tax_status,c.purchase_order,s.period,s.payment_period,s.project_id,
        (SELECT COUNT(*)::int FROM payment_instruction_lines pil WHERE pil.payment_instruction_id=pi.id) AS employee_count
        FROM payment_instructions pi JOIN clients c ON c.id=pi.client_id LEFT JOIN payroll_submissions s ON s.id=pi.submission_id
        WHERE pi.id=${body.paymentInstructionId} AND pi.org_id=${organizationId} AND pi.status='COMPLETED' LIMIT 1`;
      if (!source.length) return respond({error:'Payment belum selesai atau tidak ditemukan'},409);
      const item=source[0];
      const existing=await sql`SELECT * FROM invoices WHERE payment_instruction_id=${item.id} LIMIT 1`;
      if (existing.length) return respond({ok:true,invoice:existing[0],idempotentReplay:true});
      const rate=Number(item.billing_rate||0), employees=Number(item.employee_count||0), payroll=Number(item.expected_total||0);
      const serviceFee=item.billing_method==='PER_EMPLOYEE' ? Math.round(employees*rate)
        : item.billing_method==='PERCENTAGE_OF_PAYROLL' ? Math.round(payroll*rate/100) : Math.round(rate);
      const adminFee=Number(item.billing_admin_fee||0), reimbursement=integer(body.reimbursement||0,0), discount=integer(body.discount||0,0);
      if (reimbursement===null || discount===null || serviceFee+adminFee+reimbursement-discount<=0) return respond({error:'Billing rule belum lengkap atau nilai invoice tidak valid'},409);
      const subtotal=serviceFee+adminFee+reimbursement-discount;
      const taxRate=item.tax_status==='PKP' ? Number(item.billing_tax_rate||0) : 0;
      const taxAmount=Math.round(subtotal*taxRate/100), total=subtotal+taxAmount;
      const period=String(item.payment_period||item.period||new Date().toISOString().slice(0,7));
      if (!PERIOD.test(period)) return respond({error:'Periode invoice tidak valid'},409);
      const sequence=await sql`SELECT COUNT(*)::int+1 AS number FROM invoices WHERE org_id=${organizationId} AND period=${period}`;
      const invoiceNumber=`INV/${period.replace('-','')}/${String(item.code||'CLIENT').replace(/[^A-Z0-9]/gi,'').slice(0,10)}/${String(sequence[0]?.number||1).padStart(4,'0')}`;
      const id=`INV-${crypto.randomUUID()}`;
      const items=[
        {description:'Payroll service fee',quantity:item.billing_method==='PER_EMPLOYEE'?employees:1,rate,amount:serviceFee},
        ...(adminFee?[{description:'Administration fee',quantity:1,rate:adminFee,amount:adminFee}]:[]),
        ...(reimbursement?[{description:'Reimbursement',quantity:1,rate:reimbursement,amount:reimbursement}]:[]),
        ...(discount?[{description:'Discount',quantity:1,rate:-discount,amount:-discount}]:[]),
      ];
      const rows=await sql`INSERT INTO invoices(id,org_id,client_id,project_id,payment_instruction_id,company,period,
        invoice_number,amount,subtotal,tax_rate,tax_amount,total_amount,status,items,tax_invoice_status,created_by,updated_at)
        VALUES(${id},${organizationId},${item.client_id},${item.project_id},${item.id},${item.name},${period},
          ${invoiceNumber},${subtotal},${subtotal},${taxRate},${taxAmount},${total},'DRAFT',${JSON.stringify(items)}::jsonb,
          ${item.tax_status==='PKP'?'PENDING':'NOT_REQUIRED'},${actor.email},NOW()) RETURNING *`;
      return respond({ok:true,invoice:rows[0]},201);
    }

    if (body.action==='SUBMIT_INVOICE') {
      if (!processor(actor.role)) return respond({error:'Hanya Payroll Processor yang dapat mengajukan review'},403);
      const rows=await sql`UPDATE invoices SET status='UNDER_REVIEW',reviewed_at=NOW(),reviewed_by=${actor.email},updated_at=NOW()
        WHERE id=${body.invoiceId} AND org_id=${organizationId} AND status='DRAFT' RETURNING *`;
      if (!rows.length) return respond({error:'Invoice tidak berada pada status DRAFT'},409);
      return respond({ok:true,invoice:rows[0]});
    }

    if (body.action==='APPROVE_INVOICE') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat menyetujui invoice'},403);
      const rows=await sql`UPDATE invoices SET status='APPROVED',approved_at=NOW(),approved_by=${actor.email},updated_at=NOW()
        WHERE id=${body.invoiceId} AND org_id=${organizationId} AND status='UNDER_REVIEW'
          AND (${actor.role==='SUPER_ADMIN'} OR created_by IS DISTINCT FROM ${actor.email}) RETURNING *`;
      if (!rows.length) return respond({error:'Invoice belum diajukan atau maker tidak boleh menyetujui invoice sendiri'},409);
      return respond({ok:true,invoice:rows[0]});
    }

    if (body.action==='REVISE_INVOICE') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat meminta revisi'},403);
      const rows=await sql`UPDATE invoices SET status='DRAFT',updated_at=NOW(),review_note=${text(body.reviewNote ?? body.note,1000)}
        WHERE id=${body.invoiceId} AND org_id=${organizationId} AND status='UNDER_REVIEW' RETURNING *`;
      if (!rows.length) return respond({error:'Invoice tidak dapat direvisi pada status ini'},409);
      return respond({ok:true,invoice:rows[0]});
    }

    if (body.action==='RECORD_TAX_INVOICE') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat mencatat faktur pajak'},403);
      const status=String(body.taxInvoiceStatus ?? body.status ?? '');
      if (!['SUBMITTED','APPROVED','REJECTED'].includes(status)) return respond({error:'Status faktur pajak tidak valid'},422);
      if (status==='APPROVED' && (!text(body.taxInvoiceNumber,120) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.taxInvoiceDate||'')))) return respond({error:'Nomor dan tanggal faktur pajak wajib diisi'},422);
      const rows=await sql`UPDATE invoices SET tax_invoice_status=${status},tax_invoice_number=${text(body.taxInvoiceNumber,120)},
        tax_invoice_date=${body.taxInvoiceDate||null},coretax_reference=${text(body.coretaxReference,160)},updated_at=NOW()
        WHERE id=${body.invoiceId} AND org_id=${organizationId} AND status IN ('APPROVED','ISSUED','PARTIALLY_PAID','PAID') RETURNING *`;
      if (!rows.length) return respond({error:'Invoice belum disetujui'},409);
      return respond({ok:true,invoice:rows[0]});
    }

    if (body.action==='ISSUE_INVOICE') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat menerbitkan invoice'},403);
      const current=await sql`SELECT i.*,c.payment_terms_days,c.tax_status FROM invoices i JOIN clients c ON c.id=i.client_id
        WHERE i.id=${body.invoiceId} AND i.org_id=${organizationId} LIMIT 1`;
      if (!current.length || current[0].status!=='APPROVED') return respond({error:'Invoice belum disetujui'},409);
      if (current[0].tax_status==='PKP' && current[0].tax_invoice_status!=='APPROVED') return respond({error:'Faktur pajak Coretax belum disetujui'},409);
      const invoice=current[0],due=new Date(); due.setUTCDate(due.getUTCDate()+Number(invoice.payment_terms_days||30));
      const arId=`AR-${crypto.randomUUID()}`;
      await sql.transaction((tx)=>[
        tx`UPDATE invoices SET status='ISSUED',issued_at=NOW(),sent_at=NOW(),due_date=${due.toISOString().slice(0,10)},updated_at=NOW() WHERE id=${invoice.id}`,
        tx`INSERT INTO ar_monitor(id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,days_overdue,type,notes,updated_at)
          VALUES(${arId},${organizationId},${invoice.client_id},${invoice.project_id},${invoice.company},${invoice.id},
          ${invoice.total_amount},0,${invoice.total_amount},'OUTSTANDING',${due.toISOString()},0,'INVOICE','Billing package diterbitkan',NOW())`,
      ]);
      return respond({ok:true,invoiceId:invoice.id,arId});
    }

    if (body.action==='RECORD_AR_PAYMENT') {
      if (!controller(actor.role)) return respond({error:'Hanya Payroll Controller yang dapat mencatat pembayaran AR'},403);
      const amount=integer(body.amount,1);
      if (amount===null || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.paidAt ?? body.paymentDate ?? '')) || !text(body.reference,120)) return respond({error:'Data pembayaran AR tidak valid'},422);
      const rows=await sql`SELECT * FROM ar_monitor WHERE id=${body.arId} AND org_id=${organizationId} LIMIT 1`;
      if (!rows.length || rows[0].status==='PAID') return respond({error:'AR tidak ditemukan atau sudah lunas'},409);
      const ar=rows[0],applied=Math.min(amount,Number(ar.balance||0)),paid=Number(ar.paid_amount||0)+applied,balance=Number(ar.amount||0)-paid;
      const status=balance===0?'PAID':'PARTIAL_PAID';
      await sql.transaction((tx)=>[
        tx`INSERT INTO ar_payments(id,ar_id,amount,payment_date,reference,notes,recorded_by)
          VALUES(${`ARP-${crypto.randomUUID()}`},${ar.id},${applied},${body.paidAt ?? body.paymentDate},${text(body.reference,120)},${text(body.notes,500)},${actor.email})`,
        tx`UPDATE ar_monitor SET paid_amount=${paid},balance=${balance},status=${status},updated_at=NOW() WHERE id=${ar.id}`,
        tx`UPDATE invoices SET status=${status==='PAID'?'PAID':'PARTIAL_PAID'},paid_at=${status==='PAID'?(body.paidAt ?? body.paymentDate):null},updated_at=NOW() WHERE id=${ar.invoice_id}`,
      ]);
      return respond({ok:true,applied,balance,status});
    }

    if (body.action==='FOLLOW_UP_AR') {
      if (!processor(actor.role) && !controller(actor.role)) return respond({error:'Role tidak dapat melakukan follow-up AR'},403);
      if (!text(body.notes ?? body.note,1000)) return respond({error:'Catatan follow-up wajib diisi'},422);
      const rows=await sql`SELECT * FROM ar_monitor WHERE id=${body.arId} AND org_id=${organizationId} LIMIT 1`;
      if (!rows.length) return respond({error:'AR tidak ditemukan'},404);
      const status=body.disputed?'DISPUTED':rows[0].status;
      await sql.transaction((tx)=>[
        tx`INSERT INTO ar_follow_ups(id,ar_id,note,next_follow_up_at,created_by)
          VALUES(${`ARF-${crypto.randomUUID()}`},${body.arId},${text(body.notes ?? body.note,1000)},${body.nextFollowUpAt||null},${actor.email})`,
        tx`UPDATE ar_monitor SET status=${status},dispute_reason=${body.disputed?text(body.notes ?? body.note,1000):rows[0].dispute_reason},
          last_follow_up_at=NOW(),next_follow_up_at=${body.nextFollowUpAt||null},updated_at=NOW() WHERE id=${body.arId}`,
      ]);
      return respond({ok:true,status});
    }

    return respond({error:'Action tidak dikenal'},422);
  } catch(error) {
    return respond(publicError(error,requestId),500);
  }
}
