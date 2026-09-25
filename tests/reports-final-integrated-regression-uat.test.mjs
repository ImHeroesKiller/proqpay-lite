import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { onRequest as payrollReports } from '../functions/api/payroll-reports.js';
import { onRequest as operatingModel } from '../functions/api/operating-model.js';
import { createSession } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES
      ('CLI-RPT-A','ORG-OTSINDO','RPTA','PT Report A'),
      ('CLI-RPT-B','ORG-OTSINDO','RPTB','PT Report B');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES
      ('PRJ-RPT-A','ORG-OTSINDO','CLI-RPT-A','RPTA','Report Project A','seed'),
      ('PRJ-RPT-B','ORG-OTSINDO','CLI-RPT-B','RPTB','Report Project B','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by) VALUES
      ('SP-RPT-A','CLI-RPT-A','PRJ-RPT-A','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed'),
      ('SP-RPT-B','CLI-RPT-B','PRJ-RPT-B','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif) VALUES
      ('EMP-RPT-A','ORG-OTSINDO','CLI-RPT-A','PRJ-RPT-A','RPT-A-001','Report Employee A','ACTIVE'),
      ('EMP-RPT-B','ORG-OTSINDO','CLI-RPT-B','PRJ-RPT-B','RPT-B-001','Report Employee B','ACTIVE');
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES
      ('SUB-RPT-A','ORG-OTSINDO','CLI-RPT-A','PRJ-RPT-A','SP-RPT-A','TIER_1_PAYMENT_PROCESSING','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','COMPLETED','seed'),
      ('SUB-RPT-B','ORG-OTSINDO','CLI-RPT-B','PRJ-RPT-B','SP-RPT-B','TIER_1_PAYMENT_PROCESSING','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','COMPLETED','seed');
    INSERT INTO payroll_run_lines
      (id,submission_id,employee_id,employee_code,employee_name,gross_amount,deduction_amount,net_amount,source,included)
      VALUES
      ('LINE-RPT-A','SUB-RPT-A','EMP-RPT-A','RPT-A-001','Report Employee A',5500000,500000,5000000,'UPLOAD',1),
      ('LINE-RPT-B','SUB-RPT-B','EMP-RPT-B','RPT-B-001','Report Employee B',4500000,500000,4000000,'UPLOAD',1);

    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count,created_at,updated_at)
      VALUES
      ('PI-RPT-A-OLD','ORG-OTSINDO','CLI-RPT-A','SUB-RPT-A','REJECTED',1000000,'maker','RPT-A-OLD','PI/RPT/A/OLD',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1','IDR',1,'2026-09-20T00:00:00Z','2026-09-20T00:00:00Z'),
      ('PI-RPT-A','ORG-OTSINDO','CLI-RPT-A','SUB-RPT-A','COMPLETED',5000000,'maker','RPT-A-CURRENT','PI/RPT/A',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2','IDR',1,'2026-09-21T00:00:00Z','2026-09-21T00:00:00Z'),
      ('PI-RPT-B','ORG-OTSINDO','CLI-RPT-B','SUB-RPT-B','COMPLETED',4000000,'maker','RPT-B-CURRENT','PI/RPT/B',
       'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2','IDR',1,'2026-09-21T00:00:00Z','2026-09-21T00:00:00Z');

    INSERT INTO payment_proofs(id,payment_instruction_id,bank,reference,transaction_date,amount,uploaded_file_id,created_at) VALUES
      ('PROOF-RPT-A-OLD','PI-RPT-A-OLD','BCA','OLD-REF','2026-09-20',1000000,'OLD-FILE','2026-09-20T00:00:00Z'),
      ('PROOF-RPT-A','PI-RPT-A','BCA','CURRENT-REF','2026-09-21',5000000,'CURRENT-FILE','2026-09-21T00:00:00Z'),
      ('PROOF-RPT-B','PI-RPT-B','BCA','B-REF','2026-09-21',4000000,'B-FILE','2026-09-21T00:00:00Z');

    INSERT INTO reconciliations(id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status,reviewed_by,created_at) VALUES
      ('REC-RPT-A-OLD','PI-RPT-A-OLD',1000000,1000000,900000,-100000,'MISMATCH','controller','2026-09-25T10:00:00Z'),
      ('REC-RPT-A','PI-RPT-A',5000000,5000000,5000000,0,'MATCHED','controller','2026-09-21T00:00:00Z'),
      ('REC-RPT-B','PI-RPT-B',4000000,4000000,4000000,0,'MATCHED','controller','2026-09-21T00:00:00Z');

    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES
      ('USR-RPT-C','ORG-OTSINDO','Report Controller','controller.report@proqpay.test','PAYROLL_CONTROLLER','ACTIVE','hash','salt',100000,0,1,'seed'),
      ('USR-RPT-CLIENT','ORG-OTSINDO','Report Client','client.report@proqpay.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
    INSERT INTO user_client_scopes(user_id,client_id) VALUES('USR-RPT-CLIENT','CLI-RPT-A');
    INSERT INTO user_project_scopes(user_id,project_id) VALUES('USR-RPT-CLIENT','PRJ-RPT-A');
  `);
}

async function getReport(env,token,type){
  const response=await payrollReports({
    request:new Request(origin+`/api/payroll-reports?type=${type}&limit=500`,{
      headers:{Cookie:`proqpay_session=${token}`},
    }),
    env,
  });
  return {response,payload:await response.json()};
}

test('Final Reports UAT: control report uses only canonical non-rejected PI settlement evidence',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const controller=await createSession(DB,'USR-RPT-C',env);
  const result=await getReport(env,controller.token,'control');

  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  const row=result.payload.rows.find((item)=>item.submission_id==='SUB-RPT-A');
  assert.ok(row);
  assert.equal(Number(row.pi_total),5000000);
  assert.equal(Number(row.proof_total),5000000);
  assert.equal(Number(row.reconciliation_difference),0);
});

test('Final Reports UAT: client report scope cannot cross assigned client/project',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const client=await createSession(DB,'USR-RPT-CLIENT',env);
  const result=await getReport(env,client.token,'register');

  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.rows.length,1);
  assert.equal(result.payload.rows[0].client_name,'PT Report A');
  assert.equal(result.payload.rows[0].project_name,'Report Project A');
  assert.equal(result.payload.rows[0].employee_id,'EMP-RPT-A');
});

test('Final Reports UAT: UI keeps all-page export, stale-response guard, retry and mobile/desktop parity',async()=>{
  const workspace=await read('src/components/ReportsWorkspace.tsx');
  const css=await read('src/app/polish.css');

  assert.match(workspace,/loadAllPayrollReport/);
  assert.match(workspace,/loadAllPaymentReports/);
  assert.match(workspace,/const loadRequestRef = useRef\(0\)/);
  assert.match(workspace,/const requestId=\+\+loadRequestRef\.current/);
  assert.match(workspace,/if\(requestId!==loadRequestRef\.current\) return/);
  assert.match(workspace,/if\(requestId===loadRequestRef\.current\) setLoading\(false\)/);
  assert.match(workspace,/Coba lagi/);
  assert.match(workspace,/downloadRows\(/);
  assert.ok((workspace.match(/report-mobile-list/g)||[]).length>=2);
  assert.match(css,/\.report-desktop-table/);
  assert.match(css,/\.report-mobile-list/);
});


test('Final Reports UAT: payment report excludes rejected legacy PI and keeps canonical current PI',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const controller=await createSession(DB,'USR-RPT-C',env);
  const response=await operatingModel({
    request:new Request(origin+'/api/operating-model?resource=payment-reports&limit=500',{
      headers:{Cookie:`proqpay_session=${controller.token}`},
    }),
    env,
  });
  const payload=await response.json();
  assert.equal(response.status,200,JSON.stringify(payload));
  const ids=payload.paymentReports.map((row)=>row.id);
  assert.ok(ids.includes('PI-RPT-A'));
  assert.ok(ids.includes('PI-RPT-B'));
  assert.ok(!ids.includes('PI-RPT-A-OLD'));
  assert.ok(!payload.paymentReportFacets.statuses.includes('REJECTED'));
});

test('Final Reports UAT: payslip facets only expose report-eligible completed status',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const controller=await createSession(DB,'USR-RPT-C',env);
  const result=await getReport(env,controller.token,'payslips');
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.deepEqual(result.payload.facets.statuses,['COMPLETED']);
  assert.ok(result.payload.rows.every((row)=>row.payment_status==='COMPLETED'&&row.reconciliation_status==='MATCHED'));
});

test('Final Reports UAT: payment follow-up KPI is unique per row and mobile difference matches desktop semantics',async()=>{
  const workspace=await read('src/components/ReportsWorkspace.tsx');
  const ui=await read('src/lib/report-ui.ts');
  assert.match(workspace,/\['PAYMENT_EXCEPTION','PROOF_UPLOADED'\]\.includes\(row\.status\) \|\| row\.settlement_source === 'CONFLICT'/);
  assert.match(workspace,/function paymentDifference\(row:PaymentReport\)/);
  assert.ok((workspace.match(/paymentDifference\(row\)/g)||[]).length>=2);
  assert.match(ui,/SETTLEMENT_CONFLICT:'Konflik Settlement'/);
});
