import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordRecord } from '../functions/api/_account-auth.js';
import { onRequest as employeeLogin } from '../functions/api/employee/login.js';
import { onRequest as issueCredentials } from '../functions/api/employee-credentials.js';
import { onRequest as employeeEwa } from '../functions/api/employee/ewa.js';
import { onRequest as opsLogin } from '../functions/api/login.js';
import { onRequest as portalAudit } from '../functions/api/portal-audit.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const request=(path,options={})=>new Request(origin+path,{
  ...options,
  headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',...(options.headers||{})},
});

async function seed(DB){
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES
      ('ORG-OTSINDO','OTSINDO','OTSINDO'),
      ('ORG-OTHER','OTHER','OTHER');
    INSERT OR IGNORE INTO clients(id,org_id,code,name) VALUES
      ('CLI-ESS','ORG-OTSINDO','ESS','PT ESS');
    INSERT OR IGNORE INTO projects(id,org_id,client_id,code,name,created_by) VALUES
      ('PRJ-ESS','ORG-OTSINDO','CLI-ESS','ESS','ESS Project','seed');
    INSERT OR IGNORE INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by) VALUES
      ('SP-ESS','CLI-ESS','PRJ-ESS','TIER_2_MANAGED_PAYROLL','ACTIVE','2025-01-01','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-ESS','ORG-OTSINDO','CLI-ESS','PRJ-ESS','ESS-001','Employee ESS','ACTIVE');
    INSERT INTO employee_contracts(id,employee_id,join_date,is_current)
      VALUES('CTR-ESS','EMP-ESS','2025-01-01',1);
    INSERT INTO employee_compensation(employee_id,basic_salary,imported_net,payroll_source_period)
      VALUES('EMP-ESS',5000000,7000000,'2026-08');
    INSERT INTO ewa_policies(id,org_id,client_id,enabled,fee_rate,min_fee,min_fee_amount,max_percent,max_tenor_months,min_days_worked,min_tenure_months,min_tenure_days)
      VALUES('EWA-POL-ESS','ORG-OTSINDO','CLI-ESS',1,0.03,50000,1750000,0.3,1,0,0,0);
    INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,created_by)
      VALUES('SUB-OLD-ESS','ORG-OTSINDO','CLI-ESS','PRJ-ESS','SP-ESS','TIER_2_MANAGED_PAYROLL','2026-08','2026-08','COMPLETED','seed');
    INSERT INTO payroll_run_lines(id,submission_id,employee_id,employee_code,employee_name,gross_amount,deduction_amount,net_amount,source,included)
      VALUES('LINE-OLD-ESS','SUB-OLD-ESS','EMP-ESS','ESS-001','Employee ESS',7000000,0,7000000,'MASTER_CURRENT',1);
    INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count)
      VALUES('PI-OLD-ESS','ORG-OTSINDO','CLI-ESS','SUB-OLD-ESS','COMPLETED',7000000,'seed','ESS-PI','PI/ESS','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','IDR',1);
    INSERT INTO reconciliations(id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status,reviewed_by)
      VALUES('REC-OLD-ESS','PI-OLD-ESS',7000000,7000000,7000000,0,'MATCHED','seed');
  `);
  const record=await passwordRecord('NativeCloudflare!2026');
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(
      'USR-ESS-ADMIN','ORG-OTSINDO','Admin','admin.ess@proqpay.test','SUPER_ADMIN',
      record.hash,record.salt,record.iterations
    );
}

async function sessions(DB){
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const ops=await opsLogin({request:request('/api/login',{method:'POST',body:JSON.stringify({email:'admin.ess@proqpay.test',password:'NativeCloudflare!2026'})}),env});
  const cookie=ops.headers.get('set-cookie').split(';')[0];
  const issued=await issueCredentials({request:request('/api/employee-credentials',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify({action:'ISSUE'})}),env});
  const password=(await issued.json()).issued[0].password;
  DB.sqlite.prepare('UPDATE employee_credentials SET must_change_password=0 WHERE employee_id=?').run('EMP-ESS');
  const login=await employeeLogin({request:request('/api/employee/login',{method:'POST',body:JSON.stringify({emp_id:'ESS-001',password})}),env});
  return {env,cookie,token:(await login.json()).token};
}

test('Employee Service P0: Portal Audit excludes unknown login rows from other organizations',async()=>{
  const DB=new D1Mock(); await seed(DB);
  const {env,cookie}=await sessions(DB);
  DB.sqlite.prepare(`INSERT INTO portal_login_attempts(id,org_id,employee_id_input,employee_id,ip,success,reason)
    VALUES('ATT-OTHER','ORG-OTHER','UNKNOWN-OTHER',NULL,'203.0.113.10',0,'INVALID')`).run();
  const response=await portalAudit({request:request('/api/portal-audit',{headers:{Cookie:cookie}}),env});
  const payload=await response.json();
  assert.equal(response.status,200,JSON.stringify(payload));
  assert.ok(payload.logins.every((row)=>row.org_id==='ORG-OTSINDO'));
  assert.ok(!payload.logins.some((row)=>row.id==='ATT-OTHER'));
});

test('Employee Service P0: EWA current period does not use stale prior-period paid state or imported net',async()=>{
  const DB=new D1Mock(); await seed(DB);
  const {env,token}=await sessions(DB);
  const response=await employeeEwa({request:request('/api/employee/ewa',{headers:{Authorization:`Bearer ${token}`}}),env});
  const payload=await response.json();
  assert.equal(response.status,200,JSON.stringify(payload));
  assert.equal(payload.emp.net,5000000,'stale imported net from prior period must not set current EWA base');
  assert.notEqual(payload.reason,'Payroll periode ini sudah dibayar','prior-period paid payroll must not block current-period EWA');
});
