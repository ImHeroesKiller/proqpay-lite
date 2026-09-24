import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { onRequest as employeesApi } from '../functions/api/employees.js';
import { onRequest as credentialsApi } from '../functions/api/employee-credentials.js';
import { createSession, validatePassword } from '../functions/api/_account-auth.js';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const sameOrigin={Origin:origin,'Sec-Fetch-Site':'same-origin'};

const processor={
  id:'USR-EFINAL-P',
  email:'employees.final.processor@proqpay.test',
  role:'PAYROLL_PROCESSOR',
  permissions:['submission:write','payroll:write','payment:prepare','employees:write'],
};
const controller={
  id:'USR-EFINAL-C',
  email:'employees.final.controller@proqpay.test',
  role:'PAYROLL_CONTROLLER',
  permissions:['payment:approve','reconciliation:write'],
};
const clientActor={
  id:'USR-EFINAL-U',
  email:'employees.final.client@proqpay.test',
  role:'CLIENT_USER',
  permissions:['read'],
  clientIds:['CLI-EFINAL'],
  projectIds:['PRJ-EFINAL'],
};

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients
      (id,org_id,code,name,billing_method,billing_rate,billing_admin_fee,billing_tax_rate,tax_status,payment_terms_days)
      VALUES('CLI-EFINAL','ORG-OTSINDO','EF','PT Employees Final','FIXED',100000,0,0,'NON_PKP',30);
    INSERT INTO projects(id,org_id,client_id,code,name,status,created_by)
      VALUES('PRJ-EFINAL','ORG-OTSINDO','CLI-EFINAL','EF','Employees Final Project','ACTIVE','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-EFINAL','CLI-EFINAL','PRJ-EFINAL','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');

    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif,province,email) VALUES
      ('EMP-EFINAL-A','ORG-OTSINDO','CLI-EFINAL','PRJ-EFINAL','EF-001','Active Employee','ACTIVE','DKI Jakarta','active.employee@example.com'),
      ('EMP-EFINAL-R','ORG-OTSINDO','CLI-EFINAL','PRJ-EFINAL','EF-002','Resigned Employee','RESIGN','DKI Jakarta','resigned.employee@example.com');
    INSERT INTO employee_compensation(employee_id,basic_salary) VALUES
      ('EMP-EFINAL-A',10000000),
      ('EMP-EFINAL-R',9000000);
    INSERT INTO employee_identity(employee_id,ktp_no,npwp_no,address) VALUES
      ('EMP-EFINAL-A','3173000000000001','1234567890123456','Jl. Rahasia 1'),
      ('EMP-EFINAL-R','3173000000000002','1234567890123457','Jl. Rahasia 2');
    INSERT INTO employee_bpjs(employee_id,bpjs_kesehatan_no,jamsostek_no) VALUES
      ('EMP-EFINAL-A','0001112223334','12345678901'),
      ('EMP-EFINAL-R','0001112223335','12345678902');
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary,created_at) VALUES
      ('BANK-EFINAL-A','EMP-EFINAL-A','BCA','1234567890',1,'2026-01-01T00:00:00.000Z'),
      ('BANK-EFINAL-R','EMP-EFINAL-R','BCA','1234567891',1,'2026-01-01T00:00:00.000Z');

    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES
      ('USR-EFINAL-P','ORG-OTSINDO','Employees Final Processor','employees.final.processor@proqpay.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
      ('USR-EFINAL-C','ORG-OTSINDO','Employees Final Controller','employees.final.controller@proqpay.test','PAYROLL_CONTROLLER','ACTIVE','hash','salt',100000,0,1,'seed'),
      ('USR-EFINAL-U','ORG-OTSINDO','Employees Final Client','employees.final.client@proqpay.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
    INSERT INTO user_client_scopes(user_id,client_id) VALUES('USR-EFINAL-U','CLI-EFINAL');
    INSERT INTO user_project_scopes(user_id,project_id) VALUES('USR-EFINAL-U','PRJ-EFINAL');
  `);
}

async function operating(DB,env,actor,body){
  const response=await handleD1OperatingModel({
    request:new Request(origin+'/api/operating-model',{
      method:'POST',
      headers:{...sameOrigin,'Content-Type':'application/json'},
      body:JSON.stringify(body),
    }),
    env,
  },actor);
  return {response,payload:await response.json()};
}

async function getEmployees(env,token){
  const response=await employeesApi({
    request:new Request(origin+'/api/employees',{headers:{Cookie:`proqpay_session=${token}`,Accept:'application/json'}}),
    env,
  });
  return {response,payload:await response.json()};
}

async function postEmployee(env,token,body){
  const response=await employeesApi({
    request:new Request(origin+'/api/employees',{
      method:'POST',
      headers:{...sameOrigin,'Content-Type':'application/json',Cookie:`proqpay_session=${token}`},
      body:JSON.stringify(body),
    }),
    env,
  });
  return {response,payload:await response.json()};
}

async function postCredentials(env,token,body){
  const response=await credentialsApi({
    request:new Request(origin+'/api/employee-credentials',{
      method:'POST',
      headers:{...sameOrigin,'Content-Type':'application/json',Cookie:`proqpay_session=${token}`},
      body:JSON.stringify(body),
    }),
    env,
  });
  return {response,payload:await response.json()};
}

test('Final Employees UAT: migration normalizes duplicate primary banks and enforces one-primary invariant',async()=>{
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-MIG','ORG-OTSINDO','MIG','Migration Client');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-MIG','ORG-OTSINDO','CLI-MIG','MIG','Migration Project','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-MIG','ORG-OTSINDO','CLI-MIG','PRJ-MIG','MIG-001','Migration Employee','ACTIVE');
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary,created_at) VALUES
      ('BANK-MIG-OLD','EMP-MIG','BCA','1111111111',1,'2026-01-01T00:00:00.000Z'),
      ('BANK-MIG-NEW','EMP-MIG','MANDIRI','2222222222',1,'2026-02-01T00:00:00.000Z');
  `);
  const migration=await readFile(new URL('../migrations/0035_employee_single_primary_bank.sql',import.meta.url),'utf8');
  DB.sqlite.exec(migration);

  const primary=DB.sqlite.prepare('SELECT id,account_no FROM employee_bank_accounts WHERE employee_id=? AND is_primary=1').all('EMP-MIG');
  assert.equal(primary.length,1);
  assert.equal(primary[0].id,'BANK-MIG-NEW');
  assert.throws(
    ()=>DB.sqlite.prepare(`INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
      VALUES('BANK-MIG-ILLEGAL','EMP-MIG','BNI','3333333333',1)`).run(),
    /UNIQUE constraint failed/,
  );
});

test('Final Employees UAT: employee lifecycle, ESS, payroll snapshot, bank drift and PI remain integrated',async()=>{
  const DB=new D1Mock();seed(DB);
  const migration=await readFile(new URL('../migrations/0035_employee_single_primary_bank.sql',import.meta.url),'utf8');
  DB.sqlite.exec(migration);
  const env={
    DB,
    AUTH_MODE:'session',
    DEFAULT_ORG_ID:'ORG-OTSINDO',
    PI_ENCRYPTION_KEY:'employees-final-uat-encryption-key-32-bytes-minimum',
  };
  const processorSession=await createSession(DB,processor.id,env);
  const clientSession=await createSession(DB,clientActor.id,env);

  let result=await getEmployees(env,clientSession.token);
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.employees.length,2);
  const clientActive=result.payload.employees.find((row)=>row.id==='EMP-EFINAL-A');
  assert.ok(clientActive);
  assert.notEqual(clientActive.nik,'3173000000000001');
  assert.match(clientActive.nik,/0001$/);
  assert.notEqual(clientActive.accountNo,'1234567890');

  let credential=await postCredentials(env,processorSession.token,{action:'ISSUE',limit:10});
  assert.equal(credential.response.status,200,JSON.stringify(credential.payload));
  assert.equal(credential.payload.issued.length,1,'resigned employee must not receive ESS credential');
  assert.equal(credential.payload.issued[0].employeeId,'EMP-EFINAL-A');
  assert.equal(validatePassword(credential.payload.issued[0].password),null);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM employee_credentials WHERE employee_id=?').get('EMP-EFINAL-R').count,0);

  result=await operating(DB,env,processor,{
    action:'CREATE_PAY_RUN',
    clientId:'CLI-EFINAL',
    projectId:'PRJ-EFINAL',
    servicePlanId:'SP-EFINAL',
    period:'2026-09',
    paymentPeriod:'2026-09',
    paymentDate:'2026-09-25',
    runType:'REGULAR',
    sourceMode:'MASTER_CURRENT',
  });
  assert.equal(result.response.status,201,JSON.stringify(result.payload));
  const submissionId=result.payload.submission.id;

  const lines=DB.sqlite.prepare('SELECT employee_id,gross_amount,net_amount,account_last4 FROM payroll_run_lines WHERE submission_id=? ORDER BY employee_id').all(submissionId);
  assert.equal(lines.length,1,'resigned employee must be excluded from payroll population');
  assert.equal(lines[0].employee_id,'EMP-EFINAL-A');
  assert.equal(Number(lines[0].gross_amount),10000000);
  assert.equal(Number(lines[0].net_amount),10000000);
  assert.equal(lines[0].account_last4,'7890');

  let employeeUpdate=await postEmployee(env,processorSession.token,{
    action:'UPDATE_COMPENSATION',
    id:'EMP-EFINAL-A',
    salaryGross:12000000,
  });
  assert.equal(employeeUpdate.response.status,200,JSON.stringify(employeeUpdate.payload));
  assert.equal(DB.sqlite.prepare('SELECT basic_salary FROM employee_compensation WHERE employee_id=?').get('EMP-EFINAL-A').basic_salary,12000000);
  assert.equal(Number(DB.sqlite.prepare('SELECT gross_amount FROM payroll_run_lines WHERE submission_id=? AND employee_id=?').get(submissionId,'EMP-EFINAL-A').gross_amount),10000000,
    'existing payroll snapshot must not follow later master salary changes');

  employeeUpdate=await postEmployee(env,processorSession.token,{
    action:'UPDATE_ADMIN',
    id:'EMP-EFINAL-A',
    bankName:'MANDIRI',
    accountNo:'9999999999',
  });
  assert.equal(employeeUpdate.response.status,200,JSON.stringify(employeeUpdate.payload));

  result=await operating(DB,env,processor,{action:'FINALIZE_PAY_RUN_INPUT',submissionId,confirmation:'DATA PAYROLL FINAL'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  result=await operating(DB,env,processor,{action:'ADVANCE_PAY_RUN',submissionId,command:'VALIDATE',reviewConfirmed:true});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  result=await operating(DB,env,processor,{action:'ADVANCE_PAY_RUN',submissionId,command:'FINALIZE_PAYROLL',reviewConfirmed:true,reviewNote:'Employees final UAT'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  result=await operating(DB,env,controller,{action:'TRANSITION_SUBMISSION',submissionId,toState:'CLIENT_APPROVAL_PENDING',reviewConfirmed:true,reviewNote:'Controller final UAT'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  result=await operating(DB,env,clientActor,{action:'CLIENT_APPROVE_PAYROLL',submissionId,reviewConfirmed:true,confirmation:'SETUJUI PAYROLL',reviewNote:'Client final UAT'});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));

  result=await operating(DB,env,processor,{action:'GENERATE_PAYMENT_INSTRUCTION',submissionId});
  assert.equal(result.response.status,409,JSON.stringify(result.payload));
  assert.equal(result.payload.code,'PAY_RUN_BANK_LAST4_CHANGED');

  employeeUpdate=await postEmployee(env,processorSession.token,{
    action:'UPDATE_ADMIN',
    id:'EMP-EFINAL-A',
    bankName:'BCA',
    accountNo:'1234567890',
  });
  assert.equal(employeeUpdate.response.status,200,JSON.stringify(employeeUpdate.payload));

  result=await operating(DB,env,processor,{action:'GENERATE_PAYMENT_INSTRUCTION',submissionId});
  assert.equal(result.response.status,201,JSON.stringify(result.payload));
  const pi=result.payload.paymentInstruction;
  assert.equal(Number(pi.expected_total),10000000,'PI must use frozen payroll snapshot, not later master salary');
  assert.equal(Number(pi.recipient_count),1);
  const piLine=DB.sqlite.prepare('SELECT employee_id,beneficiary_name,bank_name,account_last4,amount FROM payment_instruction_lines WHERE payment_instruction_id=?').get(pi.id);
  assert.equal(piLine.employee_id,'EMP-EFINAL-A');
  assert.equal(piLine.bank_name,'BCA');
  assert.equal(piLine.account_last4,'7890');
  assert.equal(Number(piLine.amount),10000000);

  const employeeAudit=DB.sqlite.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity='employee' AND entity_id='EMP-EFINAL-A' AND action='EMPLOYEE_UPDATED'").get();
  assert.ok(Number(employeeAudit.count)>=3);
});
