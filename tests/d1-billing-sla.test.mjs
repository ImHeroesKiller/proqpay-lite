import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as billing } from '../functions/api/billing.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const call=(env,body)=>billing({request:new Request(`${origin}/api/billing`,{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body:JSON.stringify(body)}),env});

test('invoice SLA waits for contractual trigger and excludes weekends and holidays',async()=>{
  const DB=new D1Mock(),env={DB,DEFAULT_ORG_ID:'ORG-OTSINDO'};
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name,billing_method,billing_rate,tax_status,payment_terms_days,payment_terms_basis,sla_trigger)
      VALUES('CLI','ORG-OTSINDO','CLI','PT Client','FIXED',1000000,'NON_PKP',3,'BUSINESS_DAYS','COMPLETE_DOCUMENT_RECEIVED');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ','ORG-OTSINDO','CLI','PRJ','Project','seed');
    INSERT INTO client_service_plans(id,client_id,tier,effective_from,created_by) VALUES('SP','CLI','TIER_1_PAYMENT_PROCESSING','2026-01-01','seed');
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,state,created_by)
      VALUES('SUB','ORG-OTSINDO','CLI','PRJ','SP','TIER_1_PAYMENT_PROCESSING','2026-08','COMPLETED','seed');
    INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count)
      VALUES('PI','ORG-OTSINDO','CLI','SUB','COMPLETED',10000000,'maker','PI-key',1);
    INSERT INTO payment_instruction_lines(id,payment_instruction_id,beneficiary_name,bank_name,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
      VALUES('L','PI','Employee','BCA','****1234','cipher','iv','1234','hash',10000000);
    INSERT INTO business_holidays(id,org_id,holiday_date,name,created_by) VALUES('HOL','ORG-OTSINDO','2026-08-31','UAT holiday','seed');
  `);
  const generated=await call(env,{action:'GENERATE_INVOICE',paymentInstructionId:'PI'});
  const invoice=(await generated.json()).invoice;
  await call(env,{action:'SUBMIT_INVOICE',invoiceId:invoice.id});
  await call(env,{action:'APPROVE_INVOICE',invoiceId:invoice.id});
  const issued=await call(env,{action:'ISSUE_INVOICE',invoiceId:invoice.id});
  assert.equal(issued.status,200,await issued.clone().text());
  const awaiting=DB.sqlite.prepare('SELECT due_date,sla_status FROM invoices WHERE id=?').get(invoice.id);
  assert.equal(awaiting.due_date,null);
  assert.equal(awaiting.sla_status,'NOT_STARTED');

  const invalid=await call(env,{action:'START_INVOICE_SLA',invoiceId:invoice.id,slaTrigger:'BAST_SIGNED',triggerDate:'2026-08-28'});
  assert.equal(invalid.status,409);
  const started=await call(env,{action:'START_INVOICE_SLA',invoiceId:invoice.id,slaTrigger:'COMPLETE_DOCUMENT_RECEIVED',triggerDate:'2026-08-28',notes:'Dokumen lengkap diterima'});
  assert.equal(started.status,200,await started.clone().text());
  assert.equal((await started.json()).dueDate,'2026-09-03');
  const running=DB.sqlite.prepare('SELECT due_date,sla_status,sla_trigger_date FROM invoices WHERE id=?').get(invoice.id);
  assert.equal(running.due_date,'2026-09-03');
  assert.equal(running.sla_status,'RUNNING');
  assert.equal(running.sla_trigger_date,'2026-08-28');
  assert.equal(DB.sqlite.prepare('SELECT due_date FROM ar_monitor WHERE invoice_id=?').get(invoice.id).due_date,'2026-09-03');
});
