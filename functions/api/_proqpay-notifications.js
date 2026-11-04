import { d1First } from './_d1.js';

const TYPE = Object.freeze({
  PAYROLL_REVIEW: { label:'Persetujuan payroll diperlukan', kicker:'PAYROLL REVIEW', body:'Hasil payroll siap ditinjau. Silakan masuk ke ProQPay untuk memberikan persetujuan atau meminta revisi.', action:'Tinjau Payroll' },
  PAYROLL_APPROVED: { label:'Payroll telah disetujui', kicker:'PAYROLL APPROVAL', body:'Payroll telah mendapat persetujuan klien dan dapat dilanjutkan melalui proses Payment Instruction sesuai otorisasi.', action:'Lihat Payroll' },
  PAYROLL_REVISION: { label:'Revisi payroll diperlukan', kicker:'PAYROLL REVISION', body:'Klien meminta revisi atas hasil payroll. Tim pemroses dapat memeriksa catatan pada aplikasi ProQPay.', action:'Tinjau Revisi' },
  EWA_SUBMITTED: { label:'Pengajuan EWA menunggu persetujuan', kicker:'EWA REQUEST', body:'Terdapat pengajuan Early Wage Access baru dari karyawan. Mohon tinjau kelayakan dan berikan keputusan melalui ProQPay.', action:'Tinjau Pengajuan' },
  EWA_CLIENT_APPROVED: { label:'Pengajuan EWA disetujui klien', kicker:'EWA APPROVAL', body:'Pengajuan Early Wage Access telah disetujui klien dan menunggu tahapan internal berikutnya. Persetujuan tidak berarti dana sudah dicairkan.', action:'Lihat Pengajuan EWA' },
  EWA_APPROVED: { label:'Pengajuan EWA disetujui', kicker:'EWA UPDATE', body:'Persetujuan internal EWA selesai. Pencairan dana hanya dilakukan melalui proses disbursement dan approval yang berlaku.', action:'Lihat Status EWA' },
  EWA_REJECTED: { label:'Pengajuan EWA ditolak', kicker:'EWA DECISION', body:'Pengajuan Early Wage Access telah ditolak. Periksa detail keputusan melalui portal ProQPay.', action:'Lihat Status EWA' },
  PAYMENT_COMPLETED: { label:'Pembayaran payroll telah direkonsiliasi', kicker:'PAYMENT STATUS', body:'Rekonsiliasi pembayaran payroll telah selesai. Silakan lihat bukti dan rincian pembayaran pada ProQPay.', action:'Lihat Pembayaran' },
  GENERAL: { label:'Informasi terbaru ProQPay', kicker:'NOTIFICATION', body:'Terdapat pembaruan operasional pada akun ProQPay Anda.', action:'Buka ProQPay' },
});

export const NOTIFICATION_TYPES = Object.freeze(Object.keys(TYPE));
const emailPattern=/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function renderNotificationTemplate(type,{clientName='Klien ProQPay',reference='-',period='-',detail=''}={}) {
  const cfg=TYPE[type];
  if(!cfg) throw new Error('Unsupported notification type');
  const row=(k,v)=>'<tr><td style="padding:12px 0;border-bottom:1px solid #e5edf7;color:#64748b">'+escapeHtml(k)+'</td><td align="right" style="padding:12px 0;border-bottom:1px solid #e5edf7;color:#0a2550;font-weight:bold">'+escapeHtml(v)+'</td></tr>';
  const safeDetail=String(detail||'').slice(0,160);
  const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#18253b">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f6fb;padding:32px 12px"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#fff;border:1px solid #e3eaf3;border-radius:14px;overflow:hidden">
<tr><td style="background:#0a2550;padding:27px 32px"><div style="font-size:26px;font-weight:800;letter-spacing:-.8px;color:#fff">ProQPay<span style="color:#39b7ef">.</span></div><div style="margin-top:4px;font-size:11px;letter-spacing:1.2px;color:#bed4f0">AI PAYROLL OPERATING SYSTEM</div></td></tr>
<tr><td style="padding:33px 32px 18px"><div style="color:#2676ba;font-size:11px;font-weight:bold;letter-spacing:1.2px">${cfg.kicker}</div><h1 style="font-size:26px;line-height:1.3;color:#0a2550;margin:12px 0 19px">${escapeHtml(cfg.label)}</h1>
<p style="color:#475569;font-size:14px;line-height:1.85;margin:0 0 10px">Yth. Tim <strong>${escapeHtml(clientName)}</strong>,</p>
<p style="color:#475569;font-size:14px;line-height:1.85;margin:0">${escapeHtml(cfg.body)}</p></td></tr>
<tr><td style="padding:8px 32px 21px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
${row('Referensi',reference)}${row('Periode',period)}${safeDetail?row('Keterangan',safeDetail):''}
</table></td></tr>
<tr><td style="padding:0 32px 30px"><a href="https://proqpay.msg-os.com" style="display:inline-block;text-decoration:none;background:#0e65b1;color:#fff;font-size:13px;font-weight:700;padding:13px 21px;border-radius:8px">${cfg.action}</a>
<p style="margin:18px 0 0;font-size:12px;line-height:1.8;color:#6c7b90">Untuk keamanan, login ke ProQPay untuk melihat rincian. Email ini tidak memuat data gaji pribadi ataupun nomor rekening.</p></td></tr>
<tr><td style="padding:21px 32px;background:#f8fafc;border-top:1px solid #e7edf5"><div style="font-size:12px;color:#0a2550;font-weight:700">ProQPay · PT Mandiri Semesta Gemilang</div><div style="font-size:11px;line-height:1.8;color:#8391a3;margin-top:7px">Notifikasi otomatis. Mohon tidak membalas email ini.<br>People. Operations. Technology.</div></td></tr>
</table></td></tr></table></body></html>`;
  return {subject:`[ProQPay] ${cfg.label} · ${String(reference||'-').slice(0,70)}`,html};
}

export async function deliverProQPayNotification(env,{type,recipient,clientName,reference,period,eventId,detail}) {
  if(String(env.PROQPAY_NOTIFICATION_EMAIL_ENABLED||'false').toLowerCase()!=='true') return {status:'DISABLED'};
  if(!TYPE[type]||!emailPattern.test(String(recipient||''))) return {status:'SKIPPED'};
  if(!env.PROQPAY_MAIL_GATEWAY_URL?.startsWith('https://')||!env.PROQPAY_MAIL_GATEWAY_TOKEN) return {status:'UNCONFIGURED'};
  const rendered=renderNotificationTemplate(type,{clientName,reference,period,detail});
  const raw=`${type}/${eventId}`;
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  const requestId='notify-'+Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
  try{
    const response=await fetch(env.PROQPAY_MAIL_GATEWAY_URL,{
      method:'POST',headers:{Authorization:`Bearer ${env.PROQPAY_MAIL_GATEWAY_TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify({requestId,recipient,subject:rendered.subject,html:rendered.html,attachments:[]}),
      signal:AbortSignal.timeout(18000),
    });
    const result=await response.json().catch(()=>({}));
    return response.ok&&result.ok&&result.status==='SENT'?{status:'SENT',requestId}:{status:'FAILED',code:String(result.error||response.status)};
  }catch{
    return {status:'FAILED',code:'GATEWAY_UNREACHABLE'};
  }
}

export async function dispatchClientNotification(env,{type,clientId,reference,period,eventId,detail}) {
  if(String(env.PROQPAY_NOTIFICATION_EMAIL_ENABLED||'false').toLowerCase()!=='true') return {status:'DISABLED'};
  if(!clientId||!eventId) return {status:'SKIPPED'};
  const orgId=String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  const client=await d1First(env.DB,'SELECT name,contact_email FROM clients WHERE id=? AND org_id=? AND status=\'ACTIVE\' LIMIT 1',[clientId,orgId]);
  if(!client||!emailPattern.test(String(client.contact_email||''))) return {status:'SKIPPED'};
  return deliverProQPayNotification(env,{type,recipient:client.contact_email,clientName:client.name,reference,period,eventId,detail});
}

export function notifyAfterResponse(context, response, task) {
  if(!context.waitUntil||!response?.ok||!task||!context.env?.PROQPAY_NOTIFICATION_EMAIL_ENABLED) return response;
  const run=(async()=>{
    try{
      const json=await response.clone().json();
      if(!json?.ok||json?.idempotentReplay) return;
      await task(json);
    }catch(e){console.warn('PROQPAY_EMAIL_NOTIFICATION_FAILED',String(e?.code||'unexpected'));}
  })();
  context.waitUntil(run);
  return response;
}
