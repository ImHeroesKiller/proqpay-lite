import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Mock } from './helpers/d1-mock.mjs';
import { createSession } from '../functions/api/_account-auth.js';
import { createEmployeeSession } from '../functions/api/_employee-auth.js';
import { onRequest as enrollment } from '../functions/api/ewa-enrollment.js';
import { onRequest as employeeEwa } from '../functions/api/employee/ewa.js';
import { onRequest as approval } from '../functions/api/ewa.js';

async function fixture(){
 const DB=new D1Mock();DB.sqlite.exec(`INSERT INTO organizations(id,name,code) VALUES('O','Org','O');
 INSERT INTO clients(id,org_id,name,code) VALUES('C','O','Client','C'),('X','O','Other','X');
 INSERT INTO projects(id,org_id,client_id,name,code,created_by) VALUES('P','O','C','Project','P','seed'),('Q','O','X','Other','Q','seed');
 INSERT INTO employees(id,org_id,client_id,project_id,name,status_aktif) VALUES('E','O','C','P','Employee','ACTIVE'),('F','O','X','Q','Other','ACTIVE');
 INSERT INTO employee_compensation(employee_id,basic_salary,imported_net,payroll_source_period) VALUES('E',500000,1000000,'2026-01');
 INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) VALUES('B','E','BCA','1234567890',1);
 INSERT INTO employee_credentials(employee_id,password_hash,password_salt,must_change_password) VALUES('E','unused','unused',0);
 INSERT INTO app_users(id,org_id,name,email,role,status,must_change_password,created_by,password_hash,password_salt,password_iterations) VALUES
 ('CLIENT','O','Client','client@test','CLIENT_USER','ACTIVE',0,'seed','unused','unused',100000),
 ('EMPTY','O','No scope','empty@test','CLIENT_USER','ACTIVE',0,'seed','unused','unused',100000),
 ('OPS','O','Processor','ops@test','PAYROLL_PROCESSOR','ACTIVE',0,'seed','unused','unused',100000),
 ('CTRL','O','Controller','ctrl@test','PAYROLL_CONTROLLER','ACTIVE',0,'seed','unused','unused',100000);
 INSERT INTO user_client_scopes(user_id,client_id) VALUES('CLIENT','C');
 INSERT INTO user_project_scopes(user_id,project_id) VALUES('CLIENT','P');`);
 const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'O',SESSION_SECRET:'ewa-enrollment-test-secret-long-enough'};
 const cookies={};for(const id of ['CLIENT','EMPTY','OPS','CTRL'])cookies[id]=`proqpay_session=${(await createSession(DB,id,env)).token}`;
 const request=(path,token,body)=>new Request('https://proqpay.test'+path,{method:body?'POST':'GET',headers:{Cookie:token,Origin:'https://proqpay.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const call=(role,body,path='/api/ewa-enrollment')=>enrollment({env,request:request(path,cookies[role],body)});
 const employeeSession=await createEmployeeSession(DB,'E',env);
 const emp=(body)=>employeeEwa({env,request:new Request('https://proqpay.test/api/employee/ewa',{method:body?'POST':'GET',headers:{Authorization:`Bearer ${employeeSession.token}`,Origin:'https://proqpay.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})});
 const approve=(role,id)=>approval({env,request:request('/api/ewa',cookies[role],{action:'APPROVE',id})});
 return {DB,env,call,emp,approve};
}
const settings=(extra={})=>({employeeId:'E',enabled:true,limitMode:'PERCENT',limitPercent:.3,fixedLimit:0,salaryMode:'AUTO',manualSalary:0,reason:'Activate using latest payroll',version:0,...extra});
test('client and processor configure/enroll; scope and controller write denial remain enforced',async()=>{
 const {call,DB}=await fixture();let r=await call('CLIENT',null);let d=await r.json();assert.deepEqual(d.employees.map(x=>x.id),['E']);assert.deepEqual(d.projects.map(x=>x.id),['P']);
 assert.equal((await call('EMPTY',settings())).status,404);assert.equal((await call('CLIENT',settings({employeeId:'F'}))).status,404);
 assert.equal((await call('CTRL',settings())).status,403);
 r=await call('CLIENT',settings());assert.equal(r.status,200,await r.clone().text());d=await r.json();assert.equal(d.basis.salary,1000000);assert.equal(d.limit,300000);assert.equal(d.settings.version,1);
 assert.equal((await call('OPS',settings())).status,409);
 r=await call('OPS',settings({version:1,limitMode:'FIXED',fixedLimit:450000}));assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).limit,450000);
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='EWA_ENROLLMENT_UPDATED'").get().n,2);
});
test('registration is project-scoped and does not auto-activate or create ESS credentials',async()=>{
 const {call,DB}=await fixture();const body={action:'REGISTER',name:'New employee',employeeCode:'NEW-1',projectId:'Q',reason:'New EWA registration'};
 assert.equal((await call('CLIENT',body)).status,404);
 const r=await call('CLIENT',{...body,projectId:'P'});assert.equal(r.status,201,await r.clone().text());const id=(await r.json()).employee.id;
 assert.equal(DB.sqlite.prepare('SELECT client_id FROM employees WHERE id=?').get(id).client_id,'C');
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM ewa_employee_settings WHERE employee_id=?').get(id).n,0);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM employee_credentials WHERE employee_id=?').get(id).n,0);
});
test('no join date/current-month payroll needed after enrollment; amount is capped and client approval still required',async()=>{
 const {call,emp,approve,DB}=await fixture();await call('OPS',settings());
 let r=await emp();const d=await r.json();assert.equal(d.eligible,true,JSON.stringify(d));assert.equal(d.plafond,300000);assert.equal(d.salarySourcePeriod,'2026-01');assert.equal(d.rules.minTenureMonths,0);assert.equal(d.rules.minDaysWorked,0);
 assert.equal((await emp({amount:400000,agreed:true})).status,422);
 r=await emp({amount:200000,agreed:true});assert.equal(r.status,200,await r.clone().text());const loan=(await r.json()).request;
 assert.equal(loan.configuration_version,1);assert.equal(loan.salary_reference_snapshot,1000000);assert.equal(loan.plafond_snapshot,300000);
 assert.equal((await approve('OPS',loan.id)).status,409);
 await call('OPS',settings({version:1,fixedLimit:150000,limitMode:'FIXED'}));
 r=await approve('CLIENT',loan.id);assert.equal(r.status,409);assert.equal((await r.json()).code,'EWA_CONFIGURATION_CHANGED');
 assert.equal(DB.sqlite.prepare('SELECT status FROM ewa_requests WHERE id=?').get(loan.id).status,'SUBMITTED');
});
test('manual salary is explicit, validated, auditable and disabled enrollment blocks requests',async()=>{
 const {call,emp,DB}=await fixture();assert.equal((await call('CLIENT',settings({salaryMode:'MANUAL',manualSalary:0,manualPeriod:'2026-99'}))).status,422);
 let r=await call('CLIENT',settings({salaryMode:'MANUAL',manualSalary:2000000,manualPeriod:'2026-10'}));assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).limit,600000);
 r=await call('OPS',settings({version:1,enabled:false}));assert.equal(r.status,200);const data=await (await emp()).json();assert.equal(data.eligible,false);assert.match(data.reason,/belum diaktifkan/);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,2);
});
test('salary reference selects finalized payroll, ignores newer draft and never substitutes basic salary',async()=>{
 const {call,DB}=await fixture();
 DB.sqlite.exec(`INSERT INTO client_service_plans(id,client_id,tier,effective_from,created_by,status) VALUES('SP','C','TIER_2_MANAGED_PAYROLL','2026-01-01','seed','ACTIVE');
 INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,state,created_by) VALUES
 ('OLD','O','C','P','SP','TIER_2_MANAGED_PAYROLL','2026-02','COMPLETED','seed'),
 ('DRAFT','O','C','P','SP','TIER_2_MANAGED_PAYROLL','2026-11','DRAFT','seed');
 INSERT INTO payroll_run_lines(id,submission_id,employee_id,employee_name,source,gross_amount,deduction_amount,net_amount,included) VALUES('L1','OLD','E','Employee','TEST',2000000,0,2000000,1),('L2','DRAFT','E','Employee','TEST',9000000,0,9000000,1);
 INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key) VALUES('PI','O','C','OLD','COMPLETED',2000000,'seed','PI-UNIQUE');
 INSERT INTO reconciliations(id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status) VALUES('REC','PI',2000000,2000000,2000000,0,'MATCHED');`);
 let r=await call('OPS',settings());assert.equal(r.status,200,await r.clone().text());let data=await r.json();assert.equal(data.basis.source,'FINAL_PAYROLL');assert.equal(data.basis.period,'2026-02');assert.equal(data.limit,600000);
 DB.sqlite.exec("UPDATE employee_compensation SET imported_net=3000000,payroll_source_period='2026-03' WHERE employee_id='E'");
 r=await call('OPS',null,'/api/ewa-enrollment?employeeId=E');data=await r.json();assert.equal(data.basis.salary,3000000);assert.equal(data.basis.source,'IMPORTED_PAYROLL');
});
