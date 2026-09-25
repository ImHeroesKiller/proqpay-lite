import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { evaluateClientArGate } from '../functions/api/ar-payment-control.js';
import { ensureInvoiceDocument } from '../functions/api/invoice-document-service.js';
import { buildInvoiceDocumentSnapshot, generateInvoicePdf } from '../functions/api/invoice-document-core.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

class R2Mock {
  constructor(){this.objects=new Map();}
  async put(key,value,options={}){this.objects.set(key,{value,options});}
  async get(key){return this.objects.get(key)||null;}
}

function seedInvoice(DB){
  DB.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-BILL','PT Billing Company','BILL');
    INSERT INTO clients(id,org_id,code,name,billing_address,billing_email,billing_cc_email,npwp,purchase_order,
      payment_terms_days,tax_status,billing_method,billing_rate,billing_admin_fee,billing_tax_rate,ar_payment_block_mode,ar_warning_days)
      VALUES('CLI-BILL','ORG-BILL','CB','PT Client Invoice','Jl. Client 1, Jakarta','ap@client.test','finance@client.test',
        '01.234.567.8-999.000','PO-001',30,'PKP','FIXED',1000000,0,11,'OVERDUE',7);
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-BILL','ORG-BILL','CLI-BILL','PRJ','Payroll Managed Service','seed');
    INSERT INTO invoices(id,org_id,client_id,project_id,company,period,invoice_number,amount,subtotal,tax_rate,tax_amount,total_amount,
      status,due_date,items,tax_invoice_status,tax_invoice_number,tax_invoice_date,created_by,issued_at)
      VALUES('INV-BILL','ORG-BILL','CLI-BILL','PRJ-BILL','PT Client Invoice','2026-09','INV/202609/CB/0001',
        1000000,1000000,11,110000,1110000,'ISSUED','2026-10-26',
        '[{"description":"Payroll service fee","quantity":1,"rate":1000000,"amount":1000000}]',
        'APPROVED','010.000-26.000001','2026-09-26','maker@bill.test','2026-09-26T01:00:00Z');
    INSERT INTO billing_issuer_profiles(org_id,legal_name,address,npwp,email,phone,bank_name,bank_account_name,bank_account_no,payment_notes,updated_by)
      VALUES('ORG-BILL','PT Billing Company','Jl. Issuer 88, Jakarta','09.876.543.2-111.000','billing@issuer.test','021555',
        'Bank Mandiri','PT Billing Company','1234567890','Pembayaran dianggap sah setelah dana diterima.','admin@bill.test');
  `);
}

test('Invoice PDF is deterministic A4 business document and stored with immutable snapshot',async()=>{
  const DB=new D1Mock();seedInvoice(DB);
  const FILES=new R2Mock();
  const result=await ensureInvoiceDocument(DB,{FILES},'ORG-BILL','INV-BILL');
  assert.equal(result.status,200);
  assert.ok(result.pdf instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(result.pdf.slice(0,8)),'%PDF-1.4');
  const pdfText=new TextDecoder().decode(result.pdf);
  assert.match(pdfText,/MediaBox \[0 0 595 842\]/);
  assert.match(pdfText,/INVOICE/);
  assert.match(pdfText,/PT Mandiri Semesta Gemilang/);
  assert.match(pdfText,/PT Client Invoice/);
  assert.match(pdfText,/Graha MSG/);
  assert.match(pdfText,/www\.msg-os\.com/);
  assert.match(pdfText,/AI Payroll OS/);
  assert.match(pdfText,/1234567890/);
  assert.match(result.sha256,/^[a-f0-9]{64}$/);
  assert.equal(FILES.objects.size,1);

  const row=DB.sqlite.prepare('SELECT document_snapshot,pdf_sha256,pdf_r2_key FROM invoices WHERE id=?').get('INV-BILL');
  assert.ok(row.document_snapshot);
  assert.equal(row.pdf_sha256,result.sha256);
  assert.match(row.pdf_r2_key,/billing\/invoices\/ORG-BILL\/INV-BILL/);

  assert.throws(
    ()=>DB.sqlite.prepare("UPDATE invoices SET document_snapshot='{}' WHERE id='INV-BILL'").run(),
    /Invoice document snapshot is immutable/,
  );
});

test('AR gate warns near due date and blocks overdue or any-outstanding policies',async()=>{
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-AR','Org AR','AR');
    INSERT INTO clients(id,org_id,code,name,ar_payment_block_mode,ar_warning_days)
      VALUES('CLI-AR','ORG-AR','AR1','Client AR','OVERDUE',7);
    INSERT INTO ar_monitor(id,org_id,client_id,company,amount,paid_amount,balance,status,due_date,type)
      VALUES('AR-1','ORG-AR','CLI-AR','Client AR',100000,0,100000,'OUTSTANDING',date('now','+3 day'),'INVOICE');
  `);
  let gate=await evaluateClientArGate(DB,'ORG-AR','CLI-AR');
  assert.equal(gate.state,'WARNING');
  assert.equal(gate.blocked,false);
  assert.equal(gate.dueSoon,100000);

  DB.sqlite.prepare("UPDATE ar_monitor SET due_date=date('now','-1 day') WHERE id='AR-1'").run();
  gate=await evaluateClientArGate(DB,'ORG-AR','CLI-AR');
  assert.equal(gate.state,'BLOCKED');
  assert.equal(gate.code,'AR_OUTSTANDING_PAYMENT_BLOCKED');
  assert.equal(gate.overdue,100000);

  DB.sqlite.prepare("UPDATE ar_monitor SET due_date=date('now','+30 day') WHERE id='AR-1'").run();
  DB.sqlite.prepare("UPDATE clients SET ar_payment_block_mode='ANY_OUTSTANDING' WHERE id='CLI-AR'").run();
  gate=await evaluateClientArGate(DB,'ORG-AR','CLI-AR');
  assert.equal(gate.state,'BLOCKED');

  DB.sqlite.prepare("UPDATE clients SET ar_payment_block_mode='OFF' WHERE id='CLI-AR'").run();
  gate=await evaluateClientArGate(DB,'ORG-AR','CLI-AR');
  assert.equal(gate.blocked,false);
});

test('Invoice delivery uses provider-side attachment and keeps sent status evidence',async()=>{
  const source=await read('functions/api/invoice-email.js');
  assert.match(source,/RESEND_API_KEY/);
  assert.match(source,/BILLING_FROM_EMAIL/);
  assert.match(source,/https:\/\/api\.resend\.com\/emails/);
  assert.match(source,/Idempotency-Key/);
  assert.match(source,/attachments:\[\{filename,content:pdfBase64,content_type:'application\/pdf'\}\]/);
  assert.match(source,/email_status='SENT'/);
  assert.match(source,/sent_at=strftime/);
  assert.match(source,/invoice_delivery_events|recordInvoiceDelivery/);
});

test('Billing UI exposes A4 PDF, email delivery, issuer setup and AR payment policy',async()=>{
  const ui=await read('src/components/BillingWorkspace.tsx');
  const billing=await read('functions/api/billing.js');
  const gateway=await read('functions/api/payment-gateway.js');
  const hosted=await read('functions/api/payment-gateway-hosted.js');
  const bankExport=await read('functions/api/payment-instruction-export.js');

  assert.match(ui,/Terbitkan & kirim/);
  assert.match(ui,/PDF A4/);
  assert.match(ui,/Kirim ulang/);
  assert.match(ui,/Profil penerbit invoice/);
  assert.match(ui,/Payment block AR/);
  assert.match(ui,/ANY_OUTSTANDING/);
  assert.match(ui,/Payment gate/);
  assert.match(billing,/UPDATE_ISSUER_PROFILE/);
  assert.match(billing,/ar_payment_block_mode/);
  assert.match(gateway,/PAYMENT_BLOCKED_BY_AR/);
  assert.match(gateway,/evaluateClientArGate/);
  assert.match(hosted,/evaluateClientArGate/);
  assert.match(bankExport,/evaluateClientArGate/);
});

test('Invoice issue no longer falsely marks email sent before provider delivery',async()=>{
  const billing=await read('functions/api/billing.js');
  const issueStart=billing.indexOf("body.action==='ISSUE_INVOICE'");
  const issueEnd=billing.indexOf("body.action==='RECORD_AR_PAYMENT'");
  const issue=billing.slice(issueStart,issueEnd);
  assert.doesNotMatch(issue,/sent_at=\$\{NOW\}/);
  assert.match(issue,/issued_at=\$\{NOW\}/);
});


test('Invoice branding is canonical MSG + ProQPay and source-backed contact fields are locked',async()=>{
  const core=await read('functions/api/invoice-document-core.js');
  const billing=await read('functions/api/billing.js');
  const ui=await read('src/components/BillingWorkspace.tsx');
  const migration=await read('migrations/0042_msg_invoice_branding.sql');

  assert.match(core,/PT Mandiri Semesta Gemilang/);
  assert.match(core,/Graha MSG/);
  assert.match(core,/rizal@msg-os\.com/);
  assert.match(core,/\+62 856-9766-6101/);
  assert.match(core,/www\.msg-os\.com/);
  assert.match(core,/People\. Operations\. Technology\./);
  assert.match(core,/ProQPay Lite/);
  assert.match(core,/AI Payroll OS/);
  assert.match(core,/proqpayLogoCmd/);
  assert.match(core,/template:'MSG_PROQPAY_A4_V2'/);

  assert.match(billing,/const legalName='PT Mandiri Semesta Gemilang'/);
  assert.match(billing,/canonicalWebsite='www\.msg-os\.com'/);
  assert.match(ui,/Issuer canonical · PT Mandiri Semesta Gemilang/);
  assert.match(ui,/Company Profile MSG 2026/);

  assert.match(migration,/ALTER TABLE billing_issuer_profiles ADD COLUMN website TEXT/);
  assert.match(migration,/PT Mandiri Semesta Gemilang/);
  assert.match(migration,/Graha MSG/);
  assert.match(migration,/rizal@msg-os\.com/);
});
