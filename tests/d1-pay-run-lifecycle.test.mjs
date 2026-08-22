import assert from 'node:assert/strict';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
function request(path,body) { return new Request(`${origin}${path}`,body?{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body:JSON.stringify(body)}:{headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'}}); }
const actor={id:'USR-PROC',email:'processor@proqpay.test',role:'SUPER_ADMIN',permissions:['payment:prepare','payment:approve']};

function seed(database) {
  database.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-RUN','ORG-OTSINDO','RUN','PT RUN');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ-RUN','ORG-OTSINDO','CLI-RUN','RUN','Project Run','seed');
    INSERT INTO client_service_plans(id,client_id,tier,effective_from,created_by,status)
      VALUES('SP-RUN','CLI-RUN','TIER_2_MANAGED_PAYROLL','2026-07-15','seed','ACTIVE');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif) VALUES
      ('EMP-A','ORG-OTSINDO','CLI-RUN','PRJ-RUN','A','Ani','TETAP'),
      ('EMP-B','ORG-OTSINDO','CLI-RUN','PRJ-RUN','B','Budi','PKWT'),
      ('EMP-C','ORG-OTSINDO','CLI-RUN','PRJ-RUN','C','Cici','RESIGNED');
    INSERT INTO employee_compensation(employee_id,basic_salary) VALUES('EMP-A',5000000),('EMP-B',6000000);
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) VALUES
      ('BANK-A','EMP-A','BCA','1234567890',1),('BANK-B','EMP-B','MANDIRI','9876543210',1);
  `);
}

async function action(database,body) {
  const response=await handleD1OperatingModel({request:request('/api/operating-model',body),env:{DB:database,DEFAULT_ORG_ID:'ORG-OTSINDO'}},actor);
  return {response,payload:await response.json()};
}

test('Pay Run snapshots monthly data, compares variance, and controls period lifecycle',async()=>{
  const DB=new D1Mock(); seed(DB);
  const setupResponse=await handleD1OperatingModel({request:request('/api/operating-model?resource=pay-run-setup'),env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO'}},actor);
  const setup=await setupResponse.json();
  assert.equal(setup.projects[0].employee_count,2,'TETAP dan PKWT harus terdeteksi sebagai karyawan aktif');
  assert.equal(setup.clients[0].employee_count,2);
  const first=await action(DB,{action:'CREATE_PAY_RUN',clientId:'CLI-RUN',projectId:'PRJ-RUN',servicePlanId:'SP-RUN',period:'2026-07',paymentPeriod:'2026-07',paymentDate:'2026-07-25',runType:'REGULAR',sourceMode:'MASTER_CURRENT'});
  assert.equal(first.response.status,201,JSON.stringify(first.payload));
  const firstId=first.payload.submission.id;
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM payroll_run_lines WHERE submission_id=?').get(firstId).count,2);
  assert.equal(DB.sqlite.prepare('SELECT SUM(gross_amount) total FROM payroll_run_lines WHERE submission_id=?').get(firstId).total,11_000_000,
    'MASTER_CURRENT harus membuat nominal awal dari kompensasi master');
  assert.equal(first.payload.submission.input_status,'PENDING');

  DB.sqlite.prepare("UPDATE employee_compensation SET basic_salary=7000000 WHERE employee_id='EMP-B'").run();
  const refreshed=await action(DB,{action:'REFRESH_PAY_RUN_FROM_MASTER',submissionId:firstId});
  assert.equal(refreshed.response.status,200,JSON.stringify(refreshed.payload));
  assert.deepEqual(refreshed.payload.summary,{recipients:2,calculated:2,missingSalary:0,totalGross:12_000_000,totalDeduction:0,totalNet:12_000_000});

  for (const [employeeId,gross,deduction] of [['EMP-A',5_500_000,500_000],['EMP-B',6_500_000,500_000]]) {
    const updated=await action(DB,{action:'UPDATE_PAY_RUN_LINE',submissionId:firstId,employeeId,grossAmount:gross,deductionAmount:deduction,netAmount:gross-deduction,included:true});
    assert.equal(updated.response.status,200,JSON.stringify(updated.payload));
  }
  const finalized=await action(DB,{action:'FINALIZE_PAY_RUN_INPUT',submissionId:firstId,confirmation:'DATA PAYROLL FINAL'});
  assert.equal(finalized.payload.inputStatus,'READY');
  const submitted=await action(DB,{action:'TRANSITION_SUBMISSION',submissionId:firstId,toState:'SUBMITTED'});
  assert.equal(submitted.response.status,200,JSON.stringify(submitted.payload));
  assert.equal(submitted.payload.submission.state,'SUBMITTED');

  const duplicate=await action(DB,{action:'CREATE_PAY_RUN',clientId:'CLI-RUN',projectId:'PRJ-RUN',servicePlanId:'SP-RUN',period:'2026-07',paymentPeriod:'2026-07',paymentDate:'2026-07-25',runType:'REGULAR',sourceMode:'MASTER_CURRENT'});
  assert.equal(duplicate.response.status,409);

  const second=await action(DB,{action:'CREATE_PAY_RUN',clientId:'CLI-RUN',projectId:'PRJ-RUN',servicePlanId:'SP-RUN',period:'2026-08',paymentPeriod:'2026-08',paymentDate:'2026-08-25',runType:'REGULAR',sourceMode:'COPY_PREVIOUS'});
  assert.equal(second.response.status,201,JSON.stringify(second.payload));
  const secondId=second.payload.submission.id;
  assert.equal(second.payload.submission.input_status,'READY');
  const changed=await action(DB,{action:'UPDATE_PAY_RUN_LINE',submissionId:secondId,employeeId:'EMP-A',grossAmount:6_000_000,deductionAmount:500_000,netAmount:5_500_000,included:true});
  assert.equal(changed.response.status,200);
  await action(DB,{action:'FINALIZE_PAY_RUN_INPUT',submissionId:secondId,confirmation:'DATA PAYROLL FINAL'});
  const detailResponse=await handleD1OperatingModel({request:request(`/api/operating-model?resource=pay-run-detail&submissionId=${secondId}`),env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO'}},actor);
  const detail=await detailResponse.json();
  assert.equal(detail.variance.amount,500_000);
  assert.equal(detail.variance.changedEmployees,1);

  DB.sqlite.prepare("UPDATE payroll_submissions SET state='PAYROLL_FINALIZED' WHERE id=?").run(secondId);
  const closed=await action(DB,{action:'CLOSE_PAY_RUN',submissionId:secondId,confirmation:'TUTUP PERIODE'});
  assert.equal(closed.payload.submission.period_status,'CLOSED');
  const locked=await action(DB,{action:'UPDATE_PAY_RUN_LINE',submissionId:secondId,employeeId:'EMP-B',grossAmount:1,deductionAmount:0,netAmount:1,included:true});
  assert.equal(locked.response.status,409);
  const reopened=await action(DB,{action:'REOPEN_PAY_RUN',submissionId:secondId,reason:'Koreksi data lembur bulan Agustus',confirmation:'BUKA KEMBALI'});
  assert.equal(reopened.payload.submission.period_status,'OPEN');
  assert.equal(reopened.payload.submission.state,'REVISION_REQUIRED');

  const disposable=await action(DB,{action:'CREATE_PAY_RUN',clientId:'CLI-RUN',projectId:'PRJ-RUN',servicePlanId:'SP-RUN',period:'2026-09',paymentPeriod:'2026-09',paymentDate:'2026-09-25',runType:'OFF_CYCLE',sourceMode:'MASTER_CURRENT'});
  assert.equal(disposable.response.status,201,JSON.stringify(disposable.payload));
  const deniedDelete=await action(DB,{action:'DELETE_PAY_RUN',submissionId:disposable.payload.submission.id,confirmation:'hapus'});
  assert.equal(deniedDelete.response.status,422);
  const deleted=await action(DB,{action:'DELETE_PAY_RUN',submissionId:disposable.payload.submission.id,confirmation:'HAPUS PAY RUN'});
  assert.equal(deleted.response.status,200,JSON.stringify(deleted.payload));
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM payroll_submissions WHERE id=?').get(disposable.payload.submission.id).count,0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) count FROM payroll_run_lines WHERE submission_id=?').get(disposable.payload.submission.id).count,0);
});
