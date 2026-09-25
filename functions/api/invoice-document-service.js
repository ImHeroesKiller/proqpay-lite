import { d1First, d1Run } from './_d1.js';
import { buildInvoiceDocumentSnapshot, generateInvoicePdf, sha256Hex } from './invoice-document-core.js';

function parseSnapshot(value) {
  try {
    const parsed=JSON.parse(value||'null');
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;
  } catch {
    return null;
  }
}

export async function loadInvoiceDocumentContext(database, organizationId, invoiceId) {
  const row=await d1First(database,`SELECT i.*,c.name AS client_name,c.billing_address,c.billing_email,c.billing_cc_email,c.npwp,c.nitku,
      c.purchase_order,c.tax_status,c.payment_terms_days,p.name AS project_name,p.code AS project_code,
      o.name AS organization_name,
      bip.legal_name AS issuer_legal_name,bip.address AS issuer_address,bip.npwp AS issuer_npwp,
      bip.email AS issuer_email,bip.phone AS issuer_phone,bip.bank_name AS issuer_bank_name,
      bip.bank_account_name AS issuer_bank_account_name,bip.bank_account_no AS issuer_bank_account_no,
      bip.payment_notes AS issuer_payment_notes
    FROM invoices i
    JOIN clients c ON c.id=i.client_id
    JOIN organizations o ON o.id=i.org_id
    LEFT JOIN projects p ON p.id=i.project_id
    LEFT JOIN billing_issuer_profiles bip ON bip.org_id=i.org_id
    WHERE i.id=? AND i.org_id=? LIMIT 1`,[invoiceId,organizationId]);
  if (!row) return null;
  const issuer={
    legal_name:row.issuer_legal_name||row.organization_name,
    name:row.organization_name,
    address:row.issuer_address||'',
    npwp:row.issuer_npwp||'',
    email:row.issuer_email||'',
    phone:row.issuer_phone||'',
    bank_name:row.issuer_bank_name||'',
    bank_account_name:row.issuer_bank_account_name||'',
    bank_account_no:row.issuer_bank_account_no||'',
    payment_notes:row.issuer_payment_notes||'',
  };
  const client={
    name:row.client_name,
    billing_address:row.billing_address,
    billing_email:row.billing_email,
    billing_cc_email:row.billing_cc_email,
    npwp:row.npwp,
    nitku:row.nitku,
    purchase_order:row.purchase_order,
    tax_status:row.tax_status,
  };
  const project={name:row.project_name,code:row.project_code};
  return {invoice:row,issuer,client,project};
}

export async function ensureInvoiceDocument(database,env,organizationId,invoiceId) {
  const context=await loadInvoiceDocumentContext(database,organizationId,invoiceId);
  if (!context) return {status:404,error:'Invoice tidak ditemukan',code:'INVOICE_NOT_FOUND'};
  if (!['ISSUED','PARTIALLY_PAID','PAID'].includes(String(context.invoice.status||''))) {
    return {status:409,error:'PDF final hanya tersedia setelah invoice diterbitkan',code:'INVOICE_NOT_ISSUED'};
  }
  let snapshot=parseSnapshot(context.invoice.document_snapshot);
  if (!snapshot) {
    snapshot=buildInvoiceDocumentSnapshot(context);
    await d1Run(database,`UPDATE invoices SET document_snapshot=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND org_id=? AND document_snapshot IS NULL`,[JSON.stringify(snapshot),invoiceId,organizationId]);
    const frozen=await d1First(database,'SELECT document_snapshot FROM invoices WHERE id=? AND org_id=?',[invoiceId,organizationId]);
    snapshot=parseSnapshot(frozen?.document_snapshot)||snapshot;
  }
  const pdf=generateInvoicePdf(snapshot);
  const sha256=await sha256Hex(pdf);
  const safeNo=String(snapshot.invoiceNumber||invoiceId).replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,100);
  const key=`billing/invoices/${organizationId}/${invoiceId}/${safeNo}-${sha256.slice(0,16)}.pdf`;
  if (env.FILES?.put) {
    const existing=await env.FILES.get(key);
    if (!existing) {
      await env.FILES.put(key,pdf,{
        httpMetadata:{contentType:'application/pdf'},
        customMetadata:{invoiceId,sha256,invoiceNumber:String(snapshot.invoiceNumber||'')},
      });
    }
  }
  await d1Run(database,`UPDATE invoices SET pdf_r2_key=?,pdf_sha256=?,pdf_generated_at=COALESCE(pdf_generated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,[key,sha256,invoiceId,organizationId]);
  return {status:200,context,snapshot,pdf,sha256,key,filename:`${safeNo}.pdf`};
}

export async function recordInvoiceDelivery(database,{organizationId,invoiceId,channel,recipient=null,status='SUCCESS',providerMessageId=null,pdfSha256=null,detail=null,actor=null}) {
  await d1Run(database,`INSERT INTO invoice_delivery_events(id,org_id,invoice_id,channel,recipient,status,provider_message_id,pdf_sha256,detail,actor)
    VALUES(?,?,?,?,?,?,?,?,?,?)`,[`IDEL-${crypto.randomUUID()}`,organizationId,invoiceId,channel,recipient,status,providerMessageId,pdfSha256,detail,actor]);
}
