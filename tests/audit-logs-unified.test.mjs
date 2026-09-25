import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as auditLogs } from '../functions/api/audit-logs.js';
import { createSession, passwordRecord } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';

async function seed(DB){
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES
      ('ORG-OTSINDO','OTSINDO','OTSINDO'),
      ('ORG-OTHER','Other','OTHER');
    INSERT OR IGNORE INTO clients(id,org_id,code,name) VALUES('CLI-AUD','ORG-OTSINDO','AUD','PT Audit');
    INSERT OR IGNORE INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-AUD','ORG-OTSINDO','CLI-AUD','AUD','Audit Project','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif)
      VALUES('EMP-AUD','ORG-OTSINDO','CLI-AUD','PRJ-AUD','AUD-001','Audit Employee','ACTIVE');
    INSERT INTO portal_login_attempts(id,org_id,employee_id_input,employee_id,ip,success,reason,created_at)
      VALUES
      ('PLA-1','ORG-OTSINDO','AUD-001','EMP-AUD','10.0.0.1',0,'INVALID_CREDENTIALS','2026-09-26T01:00:00'),
      ('PLA-2','ORG-OTHER','OUTSIDER',NULL,'10.0.0.2',0,'INVALID_CREDENTIALS','2026-09-26T01:01:00');
    INSERT INTO audit_logs(id,org_id,timestamp,username,role,action,detail,entity,entity_id)
      VALUES
      ('AUD-1','ORG-OTSINDO','2026-09-26T01:02:00','Payroll Admin','SUPER_ADMIN','PAYROLL_FINALIZED','Payroll finalized','payroll_submission','SUB-1'),
      ('AUD-2','ORG-OTSINDO','2026-09-26T01:03:00','Payroll Admin','SUPER_ADMIN','EWA_APPROVED','Advance approved','ewa_request','EWA-1'),
      ('AUD-X','ORG-OTHER','2026-09-26T01:04:00','Other','SUPER_ADMIN','PAYMENT_FAILED','Other org','payment_instruction','PI-X');
  `);
  const record=await passwordRecord('AuditUnified!2026');
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(
      'USR-AUD','ORG-OTSINDO','Audit Admin','audit@proqpay.test','SUPER_ADMIN',
      record.hash,record.salt,record.iterations,
    );
}

async function call(DB,path='/api/audit-logs'){
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const session=await createSession(DB,'USR-AUD',env);
  const response=await auditLogs({
    request:new Request(origin+path,{headers:{Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:`proqpay_session=${session.token}`}}),
    env,
  });
  return {response,body:await response.json()};
}

test('unified audit API returns business audit and Employee Portal login events in one console feed',async()=>{
  const DB=new D1Mock();
  await seed(DB);
  const {response,body}=await call(DB);
  assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.authority,'D1');
  assert.equal(body.summary.total,3);
  assert.equal(body.summary.failedLogins,1);
  assert.ok(body.rows.some((row)=>row.event==='PAYROLL_FINALIZED' && row.source==='PAYROLL'));
  assert.ok(body.rows.some((row)=>row.event==='EWA_APPROVED' && row.source==='EMPLOYEE_SERVICE'));
  assert.ok(body.rows.some((row)=>row.event==='EMPLOYEE_PORTAL_LOGIN_FAILED' && row.origin==='PORTAL_LOGIN'));
  assert.ok(body.rows.every((row)=>row.id!=='AUD-X' && row.id!=='PLA-2'));
});

test('unified audit API supports source and level filters across normalized events',async()=>{
  const DB=new D1Mock();
  await seed(DB);
  let result=await call(DB,'/api/audit-logs?source=EMPLOYEE_SERVICE');
  assert.equal(result.response.status,200,JSON.stringify(result.body));
  assert.equal(result.body.summary.total,2);
  assert.ok(result.body.rows.every((row)=>row.source==='EMPLOYEE_SERVICE'));

  result=await call(DB,'/api/audit-logs?level=WARN');
  assert.equal(result.response.status,200,JSON.stringify(result.body));
  assert.equal(result.body.summary.total,1);
  assert.equal(result.body.rows[0].event,'EMPLOYEE_PORTAL_LOGIN_FAILED');
});
