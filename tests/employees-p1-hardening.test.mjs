import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as employeesApi } from '../functions/api/employees.js';
import { onRequest as credentialsApi } from '../functions/api/employee-credentials.js';
import { createSession, validatePassword } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const sameOrigin={Origin:origin,'Sec-Fetch-Site':'same-origin'};

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-P1','ORG-OTSINDO','P1','Client P1');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-P1','ORG-OTSINDO','CLI-P1','PROJP1','Project P1','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif,province,email,phone,mobile,birth_date,mother_name)
      VALUES('EMP-P1','ORG-OTSINDO','CLI-P1','PRJ-P1','P1-001','Employee P1','ACTIVE','DKI Jakarta','employee.p1@example.com','081234567890','081234567890','1990-01-02','Mother Name');
    INSERT INTO employee_compensation(employee_id,basic_salary) VALUES('EMP-P1',8000000);
    INSERT INTO employee_identity(employee_id,ktp_no,npwp_no,address)
      VALUES('EMP-P1','3173000000000001','1234567890123456','Jl. Sangat Rahasia 1');
    INSERT INTO employee_bpjs(employee_id,bpjs_kesehatan_no,jamsostek_no)
      VALUES('EMP-P1','0001112223334','12345678901');
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
      VALUES('BNK-P1','EMP-P1','BCA','1234567890',1);
    INSERT INTO employee_contracts(id,employee_id,employment_type,join_date,contract_status,is_current)
      VALUES('CTR-P1','EMP-P1','PKWT','2026-01-15','ACTIVE',1);
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES
      ('USR-P1-P','ORG-OTSINDO','P1 Processor','p1.processor@proqpay.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
      ('USR-P1-C','ORG-OTSINDO','P1 Controller','p1.controller@proqpay.test','PAYROLL_CONTROLLER','ACTIVE','hash','salt',100000,0,1,'seed'),
      ('USR-P1-U','ORG-OTSINDO','P1 Client','p1.client@proqpay.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
    INSERT INTO user_client_scopes(user_id,client_id) VALUES('USR-P1-U','CLI-P1');
    INSERT INTO user_project_scopes(user_id,project_id) VALUES('USR-P1-U','PRJ-P1');
  `);
}

async function getEmployees(env,token){
  const response=await employeesApi({request:new Request(origin+'/api/employees',{
    method:'GET',headers:{Cookie:`proqpay_session=${token}`,Accept:'application/json'},
  }),env});
  return {response,payload:await response.json()};
}

async function postEmployee(env,token,body){
  const response=await employeesApi({request:new Request(origin+'/api/employees',{
    method:'POST',
    headers:{...sameOrigin,'Content-Type':'application/json',Cookie:`proqpay_session=${token}`},
    body:JSON.stringify(body),
  }),env});
  return {response,payload:await response.json()};
}

async function postCredentials(env,token,body){
  const response=await credentialsApi({request:new Request(origin+'/api/employee-credentials',{
    method:'POST',
    headers:{...sameOrigin,'Content-Type':'application/json',Cookie:`proqpay_session=${token}`},
    body:JSON.stringify(body),
  }),env});
  return {response,payload:await response.json()};
}

test('Employees P1: read-only roles receive server-masked PII, while employee writers retain operational values',async()=>{
  const DB=new D1Mock();seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-P1-P',env);
  const controller=await createSession(DB,'USR-P1-C',env);
  const client=await createSession(DB,'USR-P1-U',env);

  const processorView=await getEmployees(env,processor.token);
  assert.equal(processorView.payload.employees[0].nik,'3173000000000001');
  assert.equal(processorView.payload.employees[0].accountNo,'1234567890');

  for(const session of [controller,client]){
    const result=await getEmployees(env,session.token);
    assert.equal(result.response.status,200);
    const row=result.payload.employees[0];
    assert.notEqual(row.nik,'3173000000000001');
    assert.match(row.nik,/0001$/);
    assert.notEqual(row.accountNo,'1234567890');
    assert.match(row.accountNo,/7890$/);
    assert.notEqual(row.bpjsKesehatanNo,'0001112223334');
    assert.notEqual(row.jamsostekNo,'12345678901');
    assert.notEqual(row.email,'employee.p1@example.com');
    assert.equal(String(row.address||''),'');
    assert.equal(String(row.birthDate||''),'');
    assert.equal(String(row.motherName||''),'');
  }
});

test('Employees P1: canonical validation rejects malformed identity, bank, BPJS, email and salary values',async()=>{
  const cases=[
    [{id:'EMP-P1',nik:'123'},'EMPLOYEE_NIK_INVALID'],
    [{id:'EMP-P1',npwp:'123'},'EMPLOYEE_NPWP_INVALID'],
    [{id:'EMP-P1',email:'not-an-email'},'EMPLOYEE_EMAIL_INVALID'],
    [{id:'EMP-P1',accountNo:'12AB'},'EMPLOYEE_BANK_ACCOUNT_INVALID'],
    [{id:'EMP-P1',bpjsKesehatanNo:'123'},'EMPLOYEE_BPJS_HEALTH_INVALID'],
    [{id:'EMP-P1',jamsostekNo:'123'},'EMPLOYEE_BPJS_WORK_INVALID'],
    [{id:'EMP-P1',salaryGross:1.25},'EMPLOYEE_SALARY_INVALID'],
  ];
  for(const [payload,code] of cases){
    const DB=new D1Mock();seed(DB);
    const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
    const processor=await createSession(DB,'USR-P1-P',env);
    const result=await postEmployee(env,processor.token,payload);
    assert.equal(result.response.status,422,JSON.stringify(result.payload));
    assert.equal(result.payload.code,code);
    assert.equal(DB.sqlite.prepare('SELECT basic_salary FROM employee_compensation WHERE employee_id=?').get('EMP-P1').basic_salary,8000000);
  }
});

test('Employees P1: valid formatted identifiers are canonicalized before persistence',async()=>{
  const DB=new D1Mock();seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-P1-P',env);
  const result=await postEmployee(env,processor.token,{
    id:'EMP-P1',
    nik:'3173-0000-0000-0002',
    npwp:'12.345.678.901.234.56',
    accountNo:'1234 5678 91',
    bpjsKesehatanNo:'0001-1122-23335',
    jamsostekNo:'1234-5678-902',
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  const identity=DB.sqlite.prepare('SELECT ktp_no,npwp_no FROM employee_identity WHERE employee_id=?').get('EMP-P1');
  assert.equal(identity.ktp_no,'3173000000000002');
  assert.equal(identity.npwp_no,'1234567890123456');
  assert.equal(DB.sqlite.prepare('SELECT account_no FROM employee_bank_accounts WHERE employee_id=? AND is_primary=1').get('EMP-P1').account_no,'1234567891');
  const bpjs=DB.sqlite.prepare('SELECT bpjs_kesehatan_no,jamsostek_no FROM employee_bpjs WHERE employee_id=?').get('EMP-P1');
  assert.equal(bpjs.bpjs_kesehatan_no,'0001112223335');
  assert.equal(bpjs.jamsostek_no,'12345678902');
});

test('Employees P1: employee master mutations create before/after audit without raw PII leakage',async()=>{
  const DB=new D1Mock();seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-P1-P',env);
  const rawNik='3173000000000099';
  const rawAccount='9988776655';
  const rawEmail='new.private@example.com';
  const result=await postEmployee(env,processor.token,{
    id:'EMP-P1',
    nik:rawNik,
    email:rawEmail,
    accountNo:rawAccount,
    bankName:'MANDIRI',
    salaryGross:8500000,
    status:'TETAP',
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.ok(result.payload.changedFields.includes('nik'));
  assert.ok(result.payload.changedFields.includes('accountNo'));
  assert.ok(result.payload.changedFields.includes('salaryGross'));
  const audit=DB.sqlite.prepare("SELECT action,detail FROM audit_logs WHERE entity='employee' AND entity_id='EMP-P1' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(audit.action,'EMPLOYEE_UPDATED');
  assert.equal(audit.detail.includes(rawNik),false);
  assert.equal(audit.detail.includes(rawAccount),false);
  assert.equal(audit.detail.includes(rawEmail),false);
  const detail=JSON.parse(audit.detail);
  assert.ok(detail.changedFields.includes('salaryGross'));
  assert.equal(detail.before.salaryGross,8000000);
  assert.equal(detail.after.salaryGross,8500000);
  assert.equal(detail.after.nik.last4,'0099');
});

test('Employees P1: ESS issuance uses high-entropy random temporary password and mandatory rotation',async()=>{
  const DB=new D1Mock();seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-P1-P',env);
  const result=await postCredentials(env,processor.token,{action:'ISSUE',limit:1});
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.issued.length,1);
  const issued=result.payload.issued[0];
  assert.equal(issued.scheme,'RANDOM_TEMPORARY');
  assert.equal(validatePassword(issued.password),null);
  assert.notEqual(issued.password,'PROJP120260115');
  assert.equal(issued.password.includes('PROJP1'),false);
  assert.equal(issued.password.includes('20260115'),false);
  const credential=DB.sqlite.prepare('SELECT must_change_password,default_password_scheme,password_hash FROM employee_credentials WHERE employee_id=?').get('EMP-P1');
  assert.equal(credential.must_change_password,1);
  assert.equal(credential.default_password_scheme,'RANDOM_TEMPORARY');
  assert.ok(credential.password_hash);
  assert.equal(String(credential.password_hash).includes(issued.password),false);
});
