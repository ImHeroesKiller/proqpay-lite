import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as employeesApi } from '../functions/api/employees.js';
import { createSession } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';
import { readFile } from 'node:fs/promises';

const origin='https://proqpay.test';
const sameOrigin={Origin:origin,'Sec-Fetch-Site':'same-origin'};

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-OTHER','Other Org','OTHER');
    INSERT INTO clients(id,org_id,code,name) VALUES
      ('CLI-EMP-A','ORG-OTSINDO','EA','Client A'),
      ('CLI-EMP-B','ORG-OTSINDO','EB','Client B'),
      ('CLI-EMP-X','ORG-OTHER','EX','Other Client');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES
      ('PRJ-EMP-A','ORG-OTSINDO','CLI-EMP-A','EA','Project A','seed'),
      ('PRJ-EMP-B','ORG-OTSINDO','CLI-EMP-B','EB','Project B','seed'),
      ('PRJ-EMP-X','ORG-OTHER','CLI-EMP-X','EX','Other Project','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif,province,email) VALUES
      ('EMP-SAFE','ORG-OTSINDO','CLI-EMP-A','PRJ-EMP-A','EA-001','Employee Safe','ACTIVE','DKI Jakarta','old@employee.test'),
      ('EMP-OTHER','ORG-OTHER','CLI-EMP-X','PRJ-EMP-X','EX-001','Employee Other','ACTIVE','Banten','other@employee.test');
    INSERT INTO employee_compensation(employee_id,basic_salary) VALUES('EMP-SAFE',7500000);
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES
      ('USR-EMP-P','ORG-OTSINDO','Employee Processor','employee.processor@proqpay.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
      ('USR-EMP-C','ORG-OTSINDO','Employee Client','employee.client@proqpay.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
    INSERT INTO user_client_scopes(user_id,client_id) VALUES('USR-EMP-C','CLI-EMP-A');
    INSERT INTO user_project_scopes(user_id,project_id) VALUES('USR-EMP-C','PRJ-EMP-A');
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

test('Employees P0: reads are isolated to active organization',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-EMP-P',env);
  const result=await getEmployees(env,processor.token);
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.deepEqual(result.payload.employees.map((row)=>row.id),['EMP-SAFE']);
  assert.equal(result.payload.employees.some((row)=>row.id==='EMP-OTHER'),false);
});

test('Employees P0: CLIENT_USER is read-only and cannot exploit update scope payloads',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const client=await createSession(DB,'USR-EMP-C',env);
  const result=await postEmployee(env,client.token,{
    id:'EMP-SAFE',
    name:'Employee Safe',
    clientId:'CLI-EMP-B',
    projectId:'PRJ-EMP-B',
    salaryGross:1,
  });
  assert.equal(result.response.status,403);
  const row=DB.sqlite.prepare('SELECT client_id,project_id FROM employees WHERE id=?').get('EMP-SAFE');
  assert.equal(row.client_id,'CLI-EMP-A');
  assert.equal(row.project_id,'PRJ-EMP-A');
  assert.equal(DB.sqlite.prepare('SELECT basic_salary FROM employee_compensation WHERE employee_id=?').get('EMP-SAFE').basic_salary,7500000);
});

test('Employees P0: administrative patch cannot overwrite compensation or employee master by omission',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-EMP-P',env);
  const result=await postEmployee(env,processor.token,{
    id:'EMP-SAFE',
    nik:'3173000000000001',
    email:'new@employee.test',
    bankName:'BCA',
    accountNo:'1234567890',
    bpjsKesehatanNo:'0001112223334',
    jamsostekNo:'12345678901',
  });
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  const row=DB.sqlite.prepare('SELECT client_id,project_id,name,status_aktif,province,email FROM employees WHERE id=?').get('EMP-SAFE');
  assert.deepEqual({ ...row },{
    client_id:'CLI-EMP-A',
    project_id:'PRJ-EMP-A',
    name:'Employee Safe',
    status_aktif:'ACTIVE',
    province:'DKI Jakarta',
    email:'new@employee.test',
  });
  assert.equal(DB.sqlite.prepare('SELECT basic_salary FROM employee_compensation WHERE employee_id=?').get('EMP-SAFE').basic_salary,7500000);
});

test('Employees P0: writes cannot target an employee from another organization',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-EMP-P',env);
  const result=await postEmployee(env,processor.token,{id:'EMP-OTHER',name:'Tampered'});
  assert.equal(result.response.status,403,JSON.stringify(result.payload));
  assert.equal(result.payload.code,'EMPLOYEE_ORG_SCOPE_DENIED');
  assert.equal(DB.sqlite.prepare('SELECT name FROM employees WHERE id=?').get('EMP-OTHER').name,'Employee Other');
});

test('Employees P0: client and project relationships must belong to active organization and each other',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-EMP-P',env);

  let result=await postEmployee(env,processor.token,{id:'EMP-SAFE',clientId:'CLI-EMP-A',projectId:'PRJ-EMP-B'});
  assert.equal(result.response.status,422);
  assert.equal(result.payload.code,'EMPLOYEE_PROJECT_SCOPE_INVALID');

  result=await postEmployee(env,processor.token,{name:'New Employee',clientId:'CLI-EMP-X',projectId:'PRJ-EMP-X'});
  assert.equal(result.response.status,422);
  assert.equal(result.payload.code,'EMPLOYEE_CLIENT_SCOPE_INVALID');
});

test('Employees P0: directory UI no longer lets CLIENT_USER edit and sends only explicit admin patch fields',async()=>{
  const source=await readFile(new URL('../src/components/EmployeeDirectory.tsx',import.meta.url),'utf8');
  assert.match(source,/const canEdit = \['SUPER_ADMIN', 'PAYROLL_PROCESSOR'\]/);
  assert.doesNotMatch(source,/\.\.\.employee, \.\.\.form/);
  assert.match(source,/id: employee\.id,\s*nik: form\.nik,/s);
  assert.doesNotMatch(source,/clientId: employee\.clientId, name: employee\.name/);
});
