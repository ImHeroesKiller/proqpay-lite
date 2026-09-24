import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { onRequest as billing } from '../functions/api/billing.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

function monthFor(index){
  const year=2000+Math.floor(index/12);
  const month=String((index%12)+1).padStart(2,'0');
  return `${year}-${month}`;
}

function seedVolume(DB,count=205){
  DB.sqlite.exec(`
    INSERT INTO clients
      (id,org_id,code,name,billing_method,billing_rate,billing_admin_fee,billing_tax_rate,tax_status,payment_terms_days)
      VALUES('CLI-P2','ORG-OTSINDO','P2','PT Billing P2','FIXED',100000,0,0,'NON_PKP',30);
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-P2','ORG-OTSINDO','CLI-P2','P2','Billing P2 Project','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-P2','CLI-P2','PRJ-P2','TIER_1_PAYMENT_PROCESSING','ACTIVE','2000-01-01','seed');
  `);
  const submission=DB.sqlite.prepare(`INSERT INTO payroll_submissions
    (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,'MASTER_CURRENT','READY','COMPLETED','seed')`);
  const pi=DB.sqlite.prepare(`INSERT INTO payment_instructions
    (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count)
    VALUES(?,?,?,?, 'COMPLETED',1000000,'maker',?,?,?,'IDR',1)`);
  const invoice=DB.sqlite.prepare(`INSERT INTO invoices
    (id,org_id,client_id,project_id,payment_instruction_id,company,period,invoice_number,amount,subtotal,tax_rate,tax_amount,total_amount,status,items,tax_invoice_status,created_by,issued_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,100000,100000,0,0,100000,'ISSUED','[]','NOT_REQUIRED','maker',?,?)`);
  const ar=DB.sqlite.prepare(`INSERT INTO ar_monitor
    (id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,days_overdue,type,updated_at)
    VALUES(?,?,?,?,?,?,100000,25000,75000,'PARTIALLY_PAID',?,0,'INVOICE',?)`);
  const payment=DB.sqlite.prepare(`INSERT INTO ar_payments(id,ar_id,amount,payment_date,reference,notes,recorded_by)
    VALUES(?,?,25000,?,?,?,'controller@proqpay.test')`);
  DB.sqlite.exec('BEGIN');
  for(let i=0;i<count;i+=1){
    const n=String(i+1).padStart(3,'0');
    const period=monthFor(i);
    const submissionId=`SUB-P2-${n}`,piId=`PI-P2-${n}`,invoiceId=`INV-P2-${n}`,arId=`AR-P2-${n}`;
    const timestamp=`${period}-15T12:00:00.000Z`;
    submission.run(submissionId,'ORG-OTSINDO','CLI-P2','PRJ-P2','SP-P2','TIER_1_PAYMENT_PROCESSING',period,period,'REGULAR');
    pi.run(piId,'ORG-OTSINDO','CLI-P2',submissionId,`KEY-P2-${n}`,`PI/P2/${n}`,n.padStart(64,'0'));
    invoice.run(invoiceId,'ORG-OTSINDO','CLI-P2','PRJ-P2',piId,'PT Billing P2',period,`INV/P2/${n}`,timestamp,timestamp);
    ar.run(arId,'ORG-OTSINDO','CLI-P2','PRJ-P2','PT Billing P2',invoiceId,`${period}-28`,timestamp);
    if(i===0){
      payment.run('ARP-P2-001',arId,`${period}-20`,'PAY-P2-001','Pembayaran parsial');
      DB.sqlite.prepare(`INSERT INTO unapplied_cash
        (id,org_id,client_id,ar_id,invoice_id,amount,payment_date,reference,notes,status,recorded_by,updated_at)
        VALUES(?,?,?,?,?,5000,?,?,?,'OPEN','controller@proqpay.test',?)`)
        .run('UC-P2-001','ORG-OTSINDO','CLI-P2',arId,invoiceId,`${period}-20`,'EXCESS-P2-001','Kelebihan bayar',timestamp);
      DB.sqlite.prepare(`INSERT INTO ar_follow_ups(id,ar_id,note,next_follow_up_at,created_by,created_at)
        VALUES(?,?,?,?,?,?)`).run('ARF-P2-001',arId,'Follow-up pertama',`${period}-25`,'controller@proqpay.test',timestamp);
      DB.sqlite.prepare(`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,timestamp)
        VALUES(?,?,?,?,?,?,?,?,?)`).run('AUD-P2-001','ORG-OTSINDO','controller@proqpay.test','PAYROLL_CONTROLLER','AR_PAYMENT_RECORDED','{"reference":"PAY-P2-001"}','ar',arId,timestamp);
      DB.sqlite.prepare(`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,timestamp)
        VALUES(?,?,?,?,?,?,?,?,?)`).run('AUD-P2-002','ORG-OTSINDO','controller@proqpay.test','PAYROLL_CONTROLLER','INVOICE_ISSUED','{"invoiceNumber":"INV/P2/001"}','invoice',invoiceId,timestamp);
    }
  }
  DB.sqlite.exec('COMMIT');
}

async function getBilling(DB,query=''){
  const env={DB,DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const response=await billing({request:new Request(origin+`/api/billing${query}`),env});
  return {response,payload:await response.json()};
}

test('Billing P2: invoice and AR collections paginate without silent truncation',async()=>{
  const DB=new D1Mock();seedVolume(DB,205);
  let result=await getBilling(DB,'?limit=100&invoiceOffset=0&arOffset=0');
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.invoices.length,100);
  assert.equal(result.payload.arItems.length,100);
  assert.equal(result.payload.meta.invoices.nextOffset,100);
  assert.equal(result.payload.meta.ar.nextOffset,100);

  result=await getBilling(DB,'?limit=100&invoiceOffset=100&arOffset=100');
  assert.equal(result.payload.invoices.length,100);
  assert.equal(result.payload.arItems.length,100);
  assert.equal(result.payload.meta.invoices.nextOffset,200);
  assert.equal(result.payload.meta.ar.nextOffset,200);

  result=await getBilling(DB,'?limit=100&invoiceOffset=200&arOffset=200');
  assert.equal(result.payload.invoices.length,5);
  assert.equal(result.payload.arItems.length,5);
  assert.equal(result.payload.meta.invoices.nextOffset,null);
  assert.equal(result.payload.meta.ar.nextOffset,null);
});

test('Billing P2: AR control equation exposes paid, unapplied, outstanding, aging and zero applied variance',async()=>{
  const DB=new D1Mock();seedVolume(DB,1);
  const result=await getBilling(DB,'?limit=10');
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  const ar=result.payload.arItems[0];
  assert.equal(ar.control.invoiceTotal,100000);
  assert.equal(ar.control.paid,25000);
  assert.equal(ar.control.unapplied,5000);
  assert.equal(ar.control.outstanding,75000);
  assert.equal(ar.control.appliedDifference,0);
  assert.ok(Array.isArray(ar.activity));
  assert.ok(ar.activity.some((entry)=>entry.type==='PAYMENT'));
  assert.ok(ar.activity.some((entry)=>entry.type==='UNAPPLIED_CASH'));
  assert.ok(ar.activity.some((entry)=>entry.type==='FOLLOW_UP'));
});

test('Billing P2: invoice activity consolidates lifecycle audit entries',async()=>{
  const DB=new D1Mock();seedVolume(DB,1);
  const result=await getBilling(DB,'?limit=10');
  const invoice=result.payload.invoices[0];
  assert.ok(Array.isArray(invoice.activity));
  assert.ok(invoice.activity.some((entry)=>entry.action==='INVOICE_ISSUED'));
});

test('Billing P2: frontend automatically aggregates Billing pages and exposes financial control/history UI',async()=>{
  const source=await read('src/components/BillingWorkspace.tsx');
  assert.match(source,/async function loadAllBillingPages/);
  assert.match(source,/billableOffset/);
  assert.match(source,/invoiceOffset/);
  assert.match(source,/arOffset/);
  assert.match(source,/new Map<string, any>\(\)/);
  assert.match(source,/Invoice total/);
  assert.match(source,/Applied payment/);
  assert.match(source,/Unapplied cash/);
  assert.match(source,/Control variance/);
  assert.match(source,/Financial activity/);
  assert.match(source,/Riwayat invoice/);
});
