import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordRecord } from '../functions/api/_account-auth.js';
import { markEwaRepaid } from '../functions/api/_ewa.js';
import { onRequest as employeeEwa } from '../functions/api/employee/ewa.js';
import { onRequest as employeeLogin } from '../functions/api/employee/login.js';
import { onRequest as issueCredentials } from '../functions/api/employee-credentials.js';
import { onRequest as ewaOps } from '../functions/api/ewa.js';
import { onRequest as opsLogin } from '../functions/api/login.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const request=(path,options={})=>new Request(origin+path,{
  ...options,
  headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',...(options.headers||{})},
});

async function seed(DB){
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-OTSINDO','OTSINDO','OTSINDO');
    INSERT OR IGNORE INTO clients(id,org_id,code,name) VALUES('CLI-EWA-P0','ORG-OTSINDO','EWA','PT EWA');
    INSERT OR IGNORE INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-EWA-P0','ORG-OTSINDO','CLI-EWA-P0','EWA','EWA Project','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-EWA-P0','ORG-OTSINDO','CLI-EWA-P0','PRJ-EWA-P0','EWA-001','Employee EWA','ACTIVE');
    INSERT INTO employee_contracts(id,employee_id,join_date,is_current)
      VALUES('CTR-EWA-P0','EMP-EWA-P0','2025-01-01',1);
    INSERT INTO employee_compensation(employee_id,basic_salary,imported_net,payroll_source_period)
      VALUES('EMP-EWA-P0',5000000,5000000,'2026-09');
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
      VALUES('BANK-EWA-P0','EMP-EWA-P0','BCA','1234567890',1);
    INSERT INTO ewa_policies(id,org_id,client_id,enabled,fee_rate,min_fee,min_fee_amount,max_percent,max_tenor_months,min_days_worked,min_tenure_months,min_tenure_days)
      VALUES('POL-EWA-P0','ORG-OTSINDO','CLI-EWA-P0',1,0.03,50000,1750000,0.3,1,0,0,0);
  `);
  for (const [id,email] of [['USR-EWA-A','ewa.a@proqpay.test'],['USR-EWA-B','ewa.b@proqpay.test']]){
    const record=await passwordRecord('NativeCloudflare!2026');
    DB.sqlite.prepare(`INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(
        id,'ORG-OTSINDO',id,email,'SUPER_ADMIN',record.hash,record.salt,record.iterations
      );
  }
}

async function opsCookie(DB,email){
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const response=await opsLogin({request:request('/api/login',{method:'POST',body:JSON.stringify({email,password:'NativeCloudflare!2026'})}),env});
  assert.equal(response.status,200,await response.clone().text());
  return response.headers.get('set-cookie').split(';')[0];
}

test('Employee Services P0: EWA disbursement requires maker-checker and transaction evidence',async()=>{
  const DB=new D1Mock(); await seed(DB);
  DB.sqlite.prepare(`INSERT INTO ewa_requests
    (id,org_id,client_id,employee_id,period,amount,fee,repayment,status,plafond_snapshot,days_worked_snapshot,tenure_months_snapshot,destination_bank_name,destination_account_last4)
    VALUES('EWA-P0','ORG-OTSINDO','CLI-EWA-P0','EMP-EWA-P0','2026-09',500000,50000,550000,'SUBMITTED',1000000,15,12,'BCA','7890')`).run();

  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const cookieA=await opsCookie(DB,'ewa.a@proqpay.test');
  const cookieB=await opsCookie(DB,'ewa.b@proqpay.test');

  const approve=await ewaOps({request:request('/api/ewa',{method:'POST',headers:{Cookie:cookieA},body:JSON.stringify({id:'EWA-P0',action:'APPROVE'})}),env});
  assert.equal(approve.status,200,await approve.clone().text());
  assert.equal((await approve.json()).request.approved_by,'ewa.a@proqpay.test');

  const sameActor=await ewaOps({request:request('/api/ewa',{method:'POST',headers:{Cookie:cookieA},body:JSON.stringify({
    id:'EWA-P0',action:'DISBURSE',source:'BANK_TRANSFER',reference:'REF-1',transactionDate:'2026-09-25',
  })}),env});
  assert.equal(sameActor.status,409);
  assert.equal((await sameActor.json()).code,'EWA_SOD_REQUIRED');

  const missingEvidence=await ewaOps({request:request('/api/ewa',{method:'POST',headers:{Cookie:cookieB},body:JSON.stringify({id:'EWA-P0',action:'DISBURSE'})}),env});
  assert.equal(missingEvidence.status,422);
  assert.equal((await missingEvidence.json()).code,'EWA_DISBURSEMENT_EVIDENCE_REQUIRED');

  const disburse=await ewaOps({request:request('/api/ewa',{method:'POST',headers:{Cookie:cookieB},body:JSON.stringify({
    id:'EWA-P0',action:'DISBURSE',source:'BANK_TRANSFER',reference:'REF-P0-001',transactionDate:'2026-09-25',
  })}),env});
  assert.equal(disburse.status,200,await disburse.clone().text());
  const row=(await disburse.json()).request;
  assert.equal(row.status,'DISBURSED');
  assert.equal(row.disbursed_by,'ewa.b@proqpay.test');
  assert.equal(row.disbursement_reference,'REF-P0-001');

  const manualRepay=await ewaOps({request:request('/api/ewa',{method:'POST',headers:{Cookie:cookieB},body:JSON.stringify({id:'EWA-P0',action:'REPAY'})}),env});
  assert.equal(manualRepay.status,409);
  assert.equal((await manualRepay.json()).code,'EWA_REPAY_IS_DERIVED');
});

test('Employee Services P0: employee submit snapshots payout destination from primary salary account',async()=>{
  const DB=new D1Mock(); await seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const adminCookie=await opsCookie(DB,'ewa.a@proqpay.test');
  const issued=await issueCredentials({request:request('/api/employee-credentials',{method:'POST',headers:{Cookie:adminCookie},body:JSON.stringify({action:'ISSUE'})}),env});
  const password=(await issued.json()).issued.find((row)=>row.employeeId==='EMP-EWA-P0').password;
  DB.sqlite.prepare('UPDATE employee_credentials SET must_change_password=0 WHERE employee_id=?').run('EMP-EWA-P0');
  const login=await employeeLogin({request:request('/api/employee/login',{method:'POST',body:JSON.stringify({emp_id:'EWA-001',password})}),env});
  const token=(await login.json()).token;

  const submit=await employeeEwa({request:request('/api/employee/ewa',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({
    action:'SUBMIT',amount:100000,method:'SALARY_ACCOUNT',agreed:true,
  })}),env});
  assert.equal(submit.status,200,await submit.clone().text());
  const created=(await submit.json()).request;
  assert.equal(created.destination_bank_name,'BCA');
  assert.equal(created.destination_account_last4,'7890');
});

test('Employee Services P0: REPAID is reconciliation-derived and writes a system audit event',async()=>{
  const DB=new D1Mock(); await seed(DB);
  DB.sqlite.exec(`
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,period,state,created_by)
      VALUES('SUB-EWA-P0','ORG-OTSINDO','CLI-EWA-P0','PRJ-EWA-P0','2026-09','RECONCILIATION','seed');
    INSERT INTO ewa_requests
      (id,org_id,client_id,employee_id,period,amount,fee,repayment,status,plafond_snapshot,days_worked_snapshot,tenure_months_snapshot,payroll_submission_id)
      VALUES('EWA-REPAY-P0','ORG-OTSINDO','CLI-EWA-P0','EMP-EWA-P0','2026-09',200000,50000,250000,'REPAYING',500000,15,12,'SUB-EWA-P0');
  `);
  await markEwaRepaid(DB,'SUB-EWA-P0');
  assert.equal(DB.sqlite.prepare("SELECT status FROM ewa_requests WHERE id='EWA-REPAY-P0'").get().status,'REPAID');
  const audit=DB.sqlite.prepare("SELECT action,role FROM audit_logs WHERE entity_id='EWA-REPAY-P0' ORDER BY timestamp DESC LIMIT 1").get();
  assert.equal(audit.action,'EWA_REPAID_RECONCILED');
  assert.equal(audit.role,'SYSTEM');
});
