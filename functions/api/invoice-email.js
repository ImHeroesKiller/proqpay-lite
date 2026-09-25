import { d1First, d1Run, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { bytesToBase64 } from './invoice-document-core.js';
import { ensureInvoiceDocument, recordInvoiceDelivery } from './invoice-document-service.js';

const METHODS='POST, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_CONTROLLER'];
function orgId(env){return String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');}
function escapeHtml(value=''){return String(value).replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim());}

async function sendResend(env,{to,cc,subject,html,filename,pdfBase64,idempotencyKey}) {
  const apiKey=String(env.RESEND_API_KEY||'').trim();
  const from=String(env.BILLING_FROM_EMAIL||'').trim();
  if(!apiKey||!from) {
    const error=new Error('Email invoice belum dikonfigurasi. RESEND_API_KEY dan BILLING_FROM_EMAIL wajib tersedia.');
    error.code='INVOICE_EMAIL_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  const payload={
    from,
    to:[to],
    subject,
    html,
    attachments:[{filename,content:pdfBase64,content_type:'application/pdf'}],
  };
  if(cc) payload.cc=[cc];
  if(env.BILLING_REPLY_TO) payload.reply_to=String(env.BILLING_REPLY_TO);
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      'Authorization':`Bearer ${apiKey}`,
      'Content-Type':'application/json',
      'Idempotency-Key':idempotencyKey,
    },
    body:JSON.stringify(payload),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(String(body?.message||body?.error||`Email provider HTTP ${response.status}`).slice(0,500));
    error.code='INVOICE_EMAIL_PROVIDER_FAILED';
    error.httpStatus=response.status;
    throw error;
  }
  return {id:String(body?.id||'')};
}

export async function onRequest({request,env}) {
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(request.method!=='POST') return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:ROLES,mutating:true,methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'invoice-email',METHODS);
  if(limited) return limited;
  if(!authorization.actor.permissions?.includes('billing:approve')) {
    return secureJson({error:'Aksi ini membutuhkan izin billing:approve',code:'BILLING_APPROVE_PERMISSION_REQUIRED'},403,request,env,METHODS);
  }
  if(!hasD1(env)) return secureJson({error:'Layanan invoice belum tersedia'},503,request,env,METHODS);
  const requestId=crypto.randomUUID();
  try{
    const body=await request.json().catch(()=>null);
    const invoiceId=String(body?.invoiceId||'').trim();
    if(!/^[A-Za-z0-9._:-]{1,120}$/.test(invoiceId)) return secureJson({error:'Invoice ID tidak valid'},422,request,env,METHODS);
    const organizationId=orgId(env);
    const invoice=await d1First(env.DB,`SELECT i.id,i.status,i.invoice_number,i.total_amount,i.due_date,i.email_status,i.email_recipient,
        c.billing_email,c.billing_cc_email,c.name AS client_name
      FROM invoices i JOIN clients c ON c.id=i.client_id
      WHERE i.id=? AND i.org_id=? LIMIT 1`,[invoiceId,organizationId]);
    if(!invoice) return secureJson({error:'Invoice tidak ditemukan'},404,request,env,METHODS);
    if(!['ISSUED','PARTIALLY_PAID','PAID'].includes(String(invoice.status||''))) {
      return secureJson({error:'Invoice harus diterbitkan sebelum dikirim',code:'INVOICE_NOT_ISSUED'},409,request,env,METHODS);
    }
    const recipient=String(body?.recipient||invoice.billing_email||'').trim().toLowerCase();
    const cc=String(body?.cc||invoice.billing_cc_email||'').trim().toLowerCase();
    if(!validEmail(recipient)) return secureJson({error:'Email tagihan klien belum valid',code:'BILLING_EMAIL_REQUIRED'},422,request,env,METHODS);
    if(cc && !validEmail(cc)) return secureJson({error:'Email CC tagihan tidak valid',code:'BILLING_CC_EMAIL_INVALID'},422,request,env,METHODS);
    if(invoice.email_status==='SENT' && String(invoice.email_recipient||'').toLowerCase()===recipient && !body?.force) {
      return secureJson({ok:true,status:'SENT',recipient,idempotentReplay:true},200,request,env,METHODS);
    }

    const document=await ensureInvoiceDocument(env.DB,env,organizationId,invoiceId);
    if(document.status!==200) return secureJson({error:document.error,code:document.code},document.status,request,env,METHODS);
    await d1Run(env.DB,`UPDATE invoices SET email_status='SENDING',email_recipient=?,email_last_error=NULL,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,[recipient,invoiceId,organizationId]);

    const snapshot=document.snapshot;
    const subject=`Invoice ${snapshot.invoiceNumber} · ${snapshot.client.name}`;
    const html=`<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6;max-width:640px">
      <h2 style="margin-bottom:4px">Invoice ${escapeHtml(snapshot.invoiceNumber)}</h2>
      <p>Yth. Tim <strong>${escapeHtml(snapshot.client.name)}</strong>,</p>
      <p>Terlampir invoice resmi untuk periode <strong>${escapeHtml(snapshot.period||'-')}</strong> dengan nilai
      <strong>Rp ${Math.round(Number(snapshot.totalAmount||0)).toLocaleString('id-ID')}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;margin:18px 0">
        <tr><td style="padding:7px;border-bottom:1px solid #e2e8f0">Nomor invoice</td><td style="padding:7px;border-bottom:1px solid #e2e8f0"><strong>${escapeHtml(snapshot.invoiceNumber)}</strong></td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #e2e8f0">Periode</td><td style="padding:7px;border-bottom:1px solid #e2e8f0">${escapeHtml(snapshot.period||'-')}</td></tr>
        <tr><td style="padding:7px;border-bottom:1px solid #e2e8f0">Jatuh tempo</td><td style="padding:7px;border-bottom:1px solid #e2e8f0">${escapeHtml(snapshot.dueDate||'-')}</td></tr>
      </table>
      <p>Mohon melakukan pembayaran sebelum tanggal jatuh tempo dan mencantumkan nomor invoice pada referensi pembayaran.</p>
      <p>Terima kasih,<br><strong>${escapeHtml(snapshot.issuer.legalName)}</strong></p>
      <p style="font-size:12px;color:#64748b">PDF A4 invoice terlampir pada email ini.</p>
    </div>`;
    try{
      const sent=await sendResend(env,{
        to:recipient,cc:cc||null,subject,html,filename:document.filename,pdfBase64:bytesToBase64(document.pdf),
        idempotencyKey:`invoice/${invoiceId}/${document.sha256}/${recipient}`,
      });
      await d1Run(env.DB,`UPDATE invoices SET email_status='SENT',email_provider_id=?,email_sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),email_last_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND org_id=?`,[sent.id||null,invoiceId,organizationId]);
      await recordInvoiceDelivery(env.DB,{organizationId,invoiceId,channel:'EMAIL',recipient,status:'SUCCESS',providerMessageId:sent.id||null,pdfSha256:document.sha256,actor:authorization.actor.email});
      return secureJson({ok:true,status:'SENT',recipient,cc:cc||null,providerMessageId:sent.id||null,pdfSha256:document.sha256},200,request,env,METHODS);
    }catch(error){
      const message=String(error?.message||error).slice(0,500);
      await d1Run(env.DB,`UPDATE invoices SET email_status='FAILED',email_last_error=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND org_id=?`,[message,invoiceId,organizationId]);
      await recordInvoiceDelivery(env.DB,{organizationId,invoiceId,channel:'EMAIL',recipient,status:'FAILED',pdfSha256:document.sha256,detail:message,actor:authorization.actor.email});
      const status=error?.code==='INVOICE_EMAIL_PROVIDER_NOT_CONFIGURED'?503:502;
      return secureJson({error:message,code:error?.code||'INVOICE_EMAIL_FAILED',pdfReady:true},status,request,env,METHODS);
    }
  }catch(error){
    return secureJson(publicError(error,requestId),500,request,env,METHODS);
  }
}
