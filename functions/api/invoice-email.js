import { d1First, d1Run, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { bytesToBase64 } from './invoice-document-core.js';
import { ensureInvoiceDocument, recordInvoiceDelivery } from './invoice-document-service.js';

const METHODS='POST, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_CONTROLLER'];
const DEFAULT_FROM_EMAIL='no-reply@arywibowo.id';
const DEFAULT_RELAY_EMAIL='ary@msg-os.com';
function orgId(env){return String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');}
function escapeHtml(value=''){return String(value).replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim());}

function relayConfig(env){
  const from=String(env.BILLING_FROM_EMAIL||DEFAULT_FROM_EMAIL).trim();
  const relayRecipient=String(env.BILLING_RELAY_EMAIL||DEFAULT_RELAY_EMAIL).trim().toLowerCase();
  if(!validEmail(from)||!validEmail(relayRecipient)) {
    const error=new Error('Konfigurasi email relay invoice tidak valid.');
    error.code='INVOICE_EMAIL_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  return {from,relayRecipient};
}

async function sendViaUbuntu(env,{recipient,cc,subject,html,filename,pdfBase64,idempotencyKey}) {
  const apiUrl=String(env.PROQPAY_MAIL_GATEWAY_URL||'').trim();
  const apiToken=String(env.PROQPAY_MAIL_GATEWAY_TOKEN||'').trim();
  if(!apiUrl.startsWith('https://')||!apiToken) {
    const error=new Error('Ubuntu SMTP gateway belum dikonfigurasi.');
    error.code='INVOICE_EMAIL_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(idempotencyKey));
  const requestId='invoice-'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  const payload={
    requestId,recipient,cc:cc||null,subject,html,
    attachments:[{filename,contentType:'application/pdf',content:pdfBase64}],
  };
  const response=await fetch(apiUrl,{
    method:'POST',
    headers:{'Authorization':`Bearer ${apiToken}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(28000),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok || !body?.ok || body?.status!=='SENT') {
    const error=new Error(String(body?.error||`Ubuntu SMTP gateway HTTP ${response.status}`).slice(0,500));
    error.code=body?.error==='SMTP_NOT_CONFIGURED'?'INVOICE_EMAIL_PROVIDER_NOT_CONFIGURED':'INVOICE_EMAIL_PROVIDER_FAILED';
    error.httpStatus=response.status;
    throw error;
  }
  return {id:requestId,relayRecipient:null,from:DEFAULT_FROM_EMAIL,transport:'UBUNTU_SMTP'};
}
async function sendResend(env,{recipient,cc,subject,html,filename,pdfBase64,idempotencyKey,invoiceId}) {
  if(String(env.PROQPAY_MAIL_GATEWAY_URL||'').trim()) {
    return sendViaUbuntu(env,{recipient,cc,subject,html,filename,pdfBase64,idempotencyKey});
  }
  const apiKey=String(env.RESEND_API_KEY||'').trim();
  const {from,relayRecipient}=relayConfig(env);
  if(!apiKey) {
    const error=new Error('Email invoice belum dikonfigurasi. RESEND_API_KEY wajib tersedia.');
    error.code='INVOICE_EMAIL_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  const headers={
    'X-ProQPay-Relay-Version':'1',
    'X-ProQPay-Forward-To':recipient,
    'X-ProQPay-Invoice-Id':String(invoiceId||''),
  };
  if(cc) headers['X-ProQPay-Forward-Cc']=cc;
  const payload={
    from,
    to:[relayRecipient],
    subject,
    html,
    headers,
    attachments:[{filename,content:pdfBase64,content_type:'application/pdf'}],
  };
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
  return {id:String(body?.id||''),relayRecipient,from};
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
    const amount='Rp '+Math.round(Number(snapshot.totalAmount||0)).toLocaleString('id-ID');
    const brand='ProQPay';
    const html=`<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#18253b">
  <div style="display:none;font-size:1px;color:#f3f6fb;line-height:1px;max-height:0;opacity:0;overflow:hidden">Invoice ${escapeHtml(snapshot.invoiceNumber)} · ${escapeHtml(snapshot.client.name)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f6fb;padding:34px 12px"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e3eaf3;border-radius:16px;overflow:hidden">
      <tr><td style="background:#0a2550;padding:26px 32px">
        <div style="font-size:25px;letter-spacing:-0.7px;font-weight:800;color:#ffffff">${brand}<span style="color:#39b7ef">.</span></div>
        <div style="margin-top:5px;font-size:11px;letter-spacing:1.3px;color:#bed4f0">AI PAYROLL OPERATING SYSTEM</div>
      </td></tr>
      <tr><td style="padding:34px 32px 22px">
        <div style="font-size:11px;letter-spacing:1.2px;font-weight:700;color:#2878bd">BILLING &amp; DOCUMENTS</div>
        <h1 style="font-size:27px;line-height:1.3;letter-spacing:-.5px;margin:10px 0 12px;color:#0a2550">Invoice telah diterbitkan</h1>
        <p style="font-size:14px;line-height:1.8;color:#45566e;margin:0 0 16px">Yth. Tim <strong style="color:#17243b">${escapeHtml(snapshot.client.name)}</strong>,</p>
        <p style="font-size:14px;line-height:1.8;color:#45566e;margin:0">Bersama email ini kami sampaikan invoice layanan ProQPay untuk periode <strong>${escapeHtml(snapshot.period||'-')}</strong>. Dokumen resmi tersedia pada lampiran PDF.</p>
      </td></tr>
      <tr><td style="padding:0 32px 22px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f9ff;border:1px solid #dce8f8;border-radius:12px">
          <tr><td style="padding:20px 22px">
            <div style="font-size:11px;color:#58718f;font-weight:700;letter-spacing:.8px">TOTAL INVOICE</div>
            <div style="font-size:29px;line-height:1.45;font-weight:800;color:#0a2550">${amount}</div>
            <div style="font-size:12px;color:#387bb5;margin-top:5px">Dokumen pembayaran resmi terlampir</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 32px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#33455e;border-collapse:collapse">
          <tr><td style="padding:12px 0;border-bottom:1px solid #e7edf5;color:#6c7c90">Nomor invoice</td><td align="right" style="padding:12px 0;border-bottom:1px solid #e7edf5;font-weight:700">${escapeHtml(snapshot.invoiceNumber)}</td></tr>
          <tr><td style="padding:12px 0;border-bottom:1px solid #e7edf5;color:#6c7c90">Periode layanan</td><td align="right" style="padding:12px 0;border-bottom:1px solid #e7edf5;font-weight:700">${escapeHtml(snapshot.period||'-')}</td></tr>
          <tr><td style="padding:12px 0;border-bottom:1px solid #e7edf5;color:#6c7c90">Jatuh tempo</td><td align="right" style="padding:12px 0;border-bottom:1px solid #e7edf5;font-weight:700">${escapeHtml(snapshot.dueDate||'-')}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 32px 32px">
        <p style="font-size:13px;line-height:1.8;color:#52647a;margin:0 0 20px">Mohon melakukan pembayaran sesuai informasi pada invoice, dan mencantumkan nomor invoice sebagai referensi transaksi.</p>
        <p style="font-size:13px;line-height:1.7;margin:0;color:#52647a">Hormat kami,<br><strong style="color:#0a2550">${escapeHtml(snapshot.issuer.legalName)}</strong></p>
      </td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e7edf5;padding:20px 32px">
        <div style="font-size:12px;font-weight:700;color:#0a2550">ProQPay · PT Mandiri Semesta Gemilang</div>
        <div style="font-size:11px;line-height:1.8;color:#8290a2;margin-top:6px">Email notifikasi otomatis. Mohon tidak membalas pesan ini.<br>© ProQPay · People. Operations. Technology.</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    try{
      const sent=await sendResend(env,{
        recipient,cc:cc||null,subject,html,filename:document.filename,pdfBase64:bytesToBase64(document.pdf),
        idempotencyKey:`invoice/${invoiceId}/${document.sha256}/${recipient}`,
        invoiceId,
      });
      await d1Run(env.DB,`UPDATE invoices SET email_status='SENT',email_provider_id=?,email_sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),email_last_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND org_id=?`,[sent.id||null,invoiceId,organizationId]);
      await recordInvoiceDelivery(env.DB,{organizationId,invoiceId,channel:'EMAIL',recipient,status:'SUCCESS',providerMessageId:sent.id||null,pdfSha256:document.sha256,detail:JSON.stringify({transport:sent.transport||'RESEND_RELAY',relayRecipient:sent.relayRecipient,from:sent.from}),actor:authorization.actor.email});
      return secureJson({ok:true,status:'SENT',recipient,cc:cc||null,relayRecipient:sent.relayRecipient,providerMessageId:sent.id||null,pdfSha256:document.sha256},200,request,env,METHODS);
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
