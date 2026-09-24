import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { onRequest as billing } from '../functions/api/billing.js';
import { createSession } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-BILL','ORG-OTSINDO','BILL','PT Billing Scope');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES
      ('PRJ-BILL-A','ORG-OTSINDO','CLI-BILL','A','Project A','seed'),
      ('PRJ-BILL-B','ORG-OTSINDO','CLI-BILL','B','Project B','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by) VALUES
      ('SP-BILL-A','CLI-BILL','PRJ-BILL-A','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed'),
      ('SP-BILL-B','CLI-BILL','PRJ-BILL-B','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES
      ('SUB-BILL-A','ORG-OTSINDO','CLI-BILL','PRJ-BILL-A','SP-BILL-A','TIER_1_PAYMENT_PROCESSING','2026-08','2026-08','REGULAR','MASTER_CURRENT','READY','COMPLETED','seed'),
      ('SUB-BILL-B','ORG-OTSINDO','CLI-BILL','PRJ-BILL-B','SP-BILL-B','TIER_1_PAYMENT_PROCESSING','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','COMPLETED','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count)
      VALUES
      ('PI-BILL-A','ORG-OTSINDO','CLI-BILL','SUB-BILL-A','COMPLETED',1000000,'maker','PI-A-key','PI/A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1','IDR',1),
      ('PI-BILL-B','ORG-OTSINDO','CLI-BILL','SUB-BILL-B','COMPLETED',2000000,'maker','PI-B-key','PI/B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2','IDR',1);
    INSERT INTO invoices
      (id,org_id,client_id,project_id,payment_instruction_id,company,period,invoice_number,amount,subtotal,tax_rate,tax_amount,total_amount,status,items,tax_invoice_status,created_by)
      VALUES
      ('INV-BILL-A','ORG-OTSINDO','CLI-BILL','PRJ-BILL-A','PI-BILL-A','PT Billing Scope','2026-08','INV/A',100000,100000,0,0,100000,'ISSUED','[]','NOT_REQUIRED','maker'),
      ('INV-BILL-B','ORG-OTSINDO','CLI-BILL','PRJ-BILL-B','PI-BILL-B','PT Billing Scope','2026-09','INV/B',200000,200000,0,0,200000,'ISSUED','[]','NOT_REQUIRED','maker');
    INSERT INTO ar_monitor
      (id,org_id,client_id,project_id,company,invoice_id,amount,paid_amount,balance,status,due_date,days_overdue,type)
      VALUES
      ('AR-BILL-A','ORG-OTSINDO','CLI-BILL','PRJ-BILL-A','PT Billing Scope','INV-BILL-A',100000,0,100000,'OUTSTANDING','2026-10-01',0,'INVOICE'),
      ('AR-BILL-B','ORG-OTSINDO','CLI-BILL','PRJ-BILL-B','PT Billing Scope','INV-BILL-B',200000,0,200000,'OUTSTANDING','2026-10-01',0,'INVOICE');
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES('USR-BILL-CLIENT','ORG-OTSINDO','Billing Client','billing.client@proqpay.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
    INSERT INTO user_client_scopes(user_id,client_id) VALUES('USR-BILL-CLIENT','CLI-BILL');
    INSERT INTO user_project_scopes(user_id,project_id) VALUES('USR-BILL-CLIENT','PRJ-BILL-A');
  `);
}

test('Billing P0: project-scoped client only sees invoice and AR for allowed project',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const session=await createSession(DB,'USR-BILL-CLIENT',env);
  const response=await billing({request:new Request(origin+'/api/billing',{
    method:'GET',
    headers:{Cookie:`proqpay_session=${session.token}`},
  }),env});
  assert.equal(response.status,200,await response.clone().text());
  const payload=await response.json();
  assert.deepEqual(payload.invoices.map((row)=>row.id),['INV-BILL-A']);
  assert.deepEqual(payload.arItems.map((row)=>row.id),['AR-BILL-A']);
});

test('Billing P0: focused submission cannot bypass project scope',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const session=await createSession(DB,'USR-BILL-CLIENT',env);
  const response=await billing({request:new Request(origin+'/api/billing?submissionId=SUB-BILL-B',{
    method:'GET',
    headers:{Cookie:`proqpay_session=${session.token}`},
  }),env});
  assert.equal(response.status,200,await response.clone().text());
  const payload=await response.json();
  assert.equal(payload.invoices.length,0);
  assert.equal(payload.arItems.length,0);
});

test('Billing P0: direct tax invoice download enforces both client and project scope',async()=>{
  const source=await read('functions/api/tax-invoice-file.js');
  assert.match(source,/SELECT id,client_id,project_id FROM invoices/);
  assert.match(source,/canAccess\(authorization\.actor,invoice\.client_id,invoice\.project_id\)/);
  assert.match(source,/projects\.includes\(String\(projectId\)\)/);
});
