import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { onRequest as employeesApi } from '../functions/api/employees.js';
import { createSession } from '../functions/api/_account-auth.js';
import { activeEmployeeSql, isActiveEmployeeStatus } from '../functions/api/_employee-status.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const sameOrigin={Origin:origin,'Sec-Fetch-Site':'same-origin'};

function seedBase(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-P2','ORG-OTSINDO','P2','Client P2');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-P2','ORG-OTSINDO','CLI-P2','P2','Project P2','seed');
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES('USR-P2-P','ORG-OTSINDO','P2 Processor','p2.processor@proqpay.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed');
  `);
}

function seedEmployees(DB,count=525){
  const stmt=DB.sqlite.prepare(`INSERT INTO employees
    (id,org_id,client_id,project_id,employee_code,name,status_aktif,province,email)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  DB.sqlite.exec('BEGIN');
  for(let i=0;i<count;i+=1){
    const n=String(i+1).padStart(4,'0');
    stmt.run(`EMP-P2-${n}`,'ORG-OTSINDO','CLI-P2','PRJ-P2',`P2-${n}`,`Employee ${n}`,i%50===0?'RESIGN':'ACTIVE','DKI Jakarta',`employee${n}@test.local`);
  }
  DB.sqlite.exec('COMMIT');
}

async function getPage(env,token,offset,limit=200){
  const response=await employeesApi({request:new Request(`${origin}/api/employees?offset=${offset}&limit=${limit}`,{
    method:'GET',headers:{Cookie:`proqpay_session=${token}`,Accept:'application/json'},
  }),env});
  return {response,payload:await response.json()};
}

async function post(env,token,body){
  const response=await employeesApi({request:new Request(origin+'/api/employees',{
    method:'POST',
    headers:{...sameOrigin,'Content-Type':'application/json',Cookie:`proqpay_session=${token}`},
    body:JSON.stringify(body),
  }),env});
  return {response,payload:await response.json()};
}

test('Employees P2: directory API paginates beyond 500 records without silent truncation',async()=>{
  const DB=new D1Mock();seedBase(DB);seedEmployees(DB,525);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-P2-P',env);

  let result=await getPage(env,processor.token,0,200);
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.employees.length,200);
  assert.equal(result.payload.meta.nextOffset,200);

  result=await getPage(env,processor.token,200,200);
  assert.equal(result.payload.employees.length,200);
  assert.equal(result.payload.meta.nextOffset,400);

  result=await getPage(env,processor.token,400,200);
  assert.equal(result.payload.employees.length,125);
  assert.equal(result.payload.meta.nextOffset,null);
  assert.equal(result.payload.meta.truncated,false);
});

test('Employees P2: canonical active policy is stable across common lifecycle values',()=>{
  for(const status of ['ACTIVE','AKTIF','TETAP','PKWT','KONTRAK','']) assert.equal(isActiveEmployeeStatus(status),true,status);
  for(const status of ['RESIGN','INACTIVE','NON AKTIF','PHK','PENSIUN','OFF','CANCELLED']) assert.equal(isActiveEmployeeStatus(status),false,status);
  assert.match(activeEmployeeSql('e'),/e\.status_aktif/);
});

test('Employees P2: UPDATE_ADMIN rejects cross-domain payroll-master fields',async()=>{
  const DB=new D1Mock();seedBase(DB);
  DB.sqlite.exec(`
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-DOMAIN','ORG-OTSINDO','CLI-P2','PRJ-P2','P2-DOMAIN','Domain Employee','ACTIVE');
    INSERT INTO employee_compensation(employee_id,basic_salary) VALUES('EMP-DOMAIN',9000000);
  `);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const processor=await createSession(DB,'USR-P2-P',env);
  const result=await post(env,processor.token,{
    action:'UPDATE_ADMIN',
    id:'EMP-DOMAIN',
    email:'domain@test.local',
    salaryGross:1,
  });
  assert.equal(result.response.status,422,JSON.stringify(result.payload));
  assert.equal(result.payload.code,'EMPLOYEE_MUTATION_DOMAIN_VIOLATION');
  assert.equal(DB.sqlite.prepare('SELECT basic_salary FROM employee_compensation WHERE employee_id=?').get('EMP-DOMAIN').basic_salary,9000000);
});

test('Employees P2: frontend sync aggregates all API pages and directory uses server canonical isActive flag',async()=>{
  const sync=await readFile(new URL('../src/lib/cloudflare-sync.ts',import.meta.url),'utf8');
  const directory=await readFile(new URL('../src/components/EmployeeDirectory.tsx',import.meta.url),'utf8');
  assert.match(sync,/async function fetchAllEmployees/);
  assert.match(sync,/\/api\/employees\?limit=200&offset=/);
  assert.match(sync,/data\?\.meta\?\.nextOffset/);
  assert.match(directory,/employee\.isActive\s*===\s*true/);
  const detail=await readFile(new URL('../src/components/EmployeeDetailDrawer.tsx',import.meta.url),'utf8');
  assert.match(detail,/action:'UPDATE_ADMIN'/);
});

test('Employees P2: employee directory query uses CTE joins and dedicated indexes instead of fixed LIMIT 500',async()=>{
  const api=await readFile(new URL('../functions/api/employees.js',import.meta.url),'utf8');
  const migration=await readFile(new URL('../migrations/0034_employee_directory_indexes.sql',import.meta.url),'utf8');
  assert.match(api,/WITH current_assignment AS/);
  assert.match(api,/primary_bank AS/);
  assert.match(api,/highest_education AS/);
  assert.doesNotMatch(api,/ORDER BY e\.name ASC\s+LIMIT 500/);
  assert.match(api,/LIMIT \? OFFSET \?/);
  assert.match(migration,/idx_employees_org_name_id/);
  assert.match(migration,/idx_employee_bank_primary_created/);
});

test('Employees P2: payroll and ESS import the same canonical lifecycle helper',async()=>{
  const payroll=await readFile(new URL('../functions/api/operating-model-d1.js',import.meta.url),'utf8');
  const credential=await readFile(new URL('../functions/api/employee-credentials.js',import.meta.url),'utf8');
  const auth=await readFile(new URL('../functions/api/_employee-auth.js',import.meta.url),'utf8');
  assert.match(payroll,/activeEmployeeSql/);
  assert.match(credential,/activeEmployeeSql/);
  assert.match(auth,/isActiveEmployeeStatus/);
});
