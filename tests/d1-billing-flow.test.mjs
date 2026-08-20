import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as billing } from '../functions/api/billing.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const call=(env,body)=>billing({request:new Request(`${origin}/api/billing`,{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body:JSON.stringify(body)}),env});

test('D1 billing creates invoice, AR, and records settlement transactionally',async()=>{
  const DB=new D1Mock(),env={DB,DEFAULT_ORG_ID:'ORG-OTSINDO'};
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name,billing_method,billing_rate,billing_admin_fee,tax_status)
      VALUES('CLI','ORG-OTSINDO','CLI','PT Client','FIXED',1000000,50000,'NON_PKP');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ','ORG-OTSINDO','CLI','PRJ','Project','seed');
    INSERT INTO client_service_plans(id,client_id,tier,effective_from,created_by) VALUES('SP','CLI','TIER_1_PAYMENT_PROCESSING','2026-01-01','seed');
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,state,created_by)
      VALUES('SUB','ORG-OTSINDO','CLI','PRJ','SP','TIER_1_PAYMENT_PROCESSING','2026-08','COMPLETED','seed');
    INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count)
      VALUES('PI','ORG-OTSINDO','CLI','SUB','COMPLETED',10000000,'maker','PI-key',1);
    INSERT INTO payment_instruction_lines(id,payment_instruction_id,beneficiary_name,bank_name,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
      VALUES('L','PI','Employee','BCA','****1234','cipher','iv','1234','hash',10000000);
  `);
  const generated=await call(env,{action:'GENERATE_INVOICE',paymentInstructionId:'PI'});
  assert.equal(generated.status,201,await generated.clone().text());
  const invoice=(await generated.json()).invoice;
  assert.equal(invoice.total_amount,1050000);
  assert.equal((await call(env,{action:'SUBMIT_INVOICE',invoiceId:invoice.id})).status,200);
  assert.equal((await call(env,{action:'APPROVE_INVOICE',invoiceId:invoice.id})).status,200);
  const issued=await call(env,{action:'ISSUE_INVOICE',invoiceId:invoice.id});
  assert.equal(issued.status,200,await issued.clone().text());
  const arId=(await issued.json()).arId;
  const paid=await call(env,{action:'RECORD_AR_PAYMENT',arId,amount:1050000,paymentDate:'2026-08-31',reference:'BANK-REF'});
  assert.equal(paid.status,200,await paid.clone().text());
  assert.equal((await paid.json()).status,'PAID');
  assert.equal(DB.sqlite.prepare('SELECT status FROM invoices WHERE id=?').get(invoice.id).status,'PAID');
});
