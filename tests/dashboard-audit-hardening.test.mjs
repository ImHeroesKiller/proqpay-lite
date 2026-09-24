import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const env=(DB)=>({DB,DEFAULT_ORG_ID:'ORG-OTSINDO'});
const internal={id:'USR-DASH-SA',email:'admin.dashboard@proqpay.test',role:'SUPER_ADMIN',permissions:[]};
const client={id:'USR-DASH-CL',email:'client.dashboard@proqpay.test',role:'CLIENT_USER',permissions:['read'],clientIds:['CLI-DASH-A'],projectIds:['PRJ-DASH-A']};

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES
      ('CLI-DASH-A','ORG-OTSINDO','DA','PT Dashboard A'),
      ('CLI-DASH-B','ORG-OTSINDO','DB','PT Dashboard B');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES
      ('PRJ-DASH-A','ORG-OTSINDO','CLI-DASH-A','DA','Project A','seed'),
      ('PRJ-DASH-B','ORG-OTSINDO','CLI-DASH-B','DB','Project B','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by) VALUES
      ('SP-DASH-A','CLI-DASH-A','PRJ-DASH-A','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed'),
      ('SP-DASH-B','CLI-DASH-B','PRJ-DASH-B','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif) VALUES
      ('EMP-DASH-A','ORG-OTSINDO','CLI-DASH-A','PRJ-DASH-A','DA-001','Employee A','ACTIVE'),
      ('EMP-DASH-B','ORG-OTSINDO','CLI-DASH-B','PRJ-DASH-B','DB-001','Employee B','ACTIVE');
    INSERT INTO employee_compensation(employee_id,basic_salary) VALUES
      ('EMP-DASH-A',5000000),('EMP-DASH-B',6000000);
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) VALUES
      ('BANK-DASH-A','EMP-DASH-A','BCA','1234567890',1),
      ('BANK-DASH-B','EMP-DASH-B','BCA','9876543210',1);
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES
      ('SUB-DASH-SEP','ORG-OTSINDO','CLI-DASH-A','PRJ-DASH-A','SP-DASH-A','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','PAYMENT_APPROVAL_PENDING','seed'),
      ('SUB-DASH-AUG','ORG-OTSINDO','CLI-DASH-A','PRJ-DASH-A','SP-DASH-A','TIER_2_MANAGED_PAYROLL','2026-08','2026-08','REGULAR','MASTER_CURRENT','READY','COMPLETED','seed'),
      ('SUB-DASH-OTHER','ORG-OTSINDO','CLI-DASH-B','PRJ-DASH-B','SP-DASH-B','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','VALIDATED','seed');
    INSERT INTO payroll_run_lines
      (id,submission_id,employee_id,employee_code,employee_name,bank_name,account_last4,gross_amount,deduction_amount,net_amount,components,source,included)
      VALUES
      ('LINE-DASH-SEP','SUB-DASH-SEP','EMP-DASH-A','DA-001','Employee A','BCA','7890',5500000,500000,5000000,'{}','MASTER_CURRENT',1),
      ('LINE-DASH-AUG','SUB-DASH-AUG','EMP-DASH-A','DA-001','Employee A','BCA','7890',5200000,400000,4800000,'{}','MASTER_CURRENT',1),
      ('LINE-DASH-OTHER','SUB-DASH-OTHER','EMP-DASH-B','DB-001','Employee B','BCA','3210',6500000,500000,6000000,'{}','MASTER_CURRENT',1);
    INSERT INTO payroll_exceptions(id,submission_id,employee_id,category,severity,owner,status)
      VALUES
      ('EX-DASH-OPEN','SUB-DASH-SEP','EMP-DASH-A','BANK','WARNING','PAYROLL_PROCESSOR','OPEN'),
      ('EX-DASH-AUTO','SUB-DASH-SEP','EMP-DASH-A','NORMALIZED','INFO','SYSTEM','AUTO_NORMALIZED'),
      ('EX-DASH-CLIENT','SUB-DASH-SEP','EMP-DASH-A','CLIENT','WARNING','CLIENT_USER','CLIENT_ACTION_REQUIRED');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count,created_at,updated_at)
      VALUES
      ('PI-DASH-REJECTED','ORG-OTSINDO','CLI-DASH-A','SUB-DASH-SEP','REJECTED',4900000,'maker','pi-dash-old','PI/OLD','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','IDR',1,'2026-09-01','2026-09-01'),
      ('PI-DASH-ACTIVE','ORG-OTSINDO','CLI-DASH-A','SUB-DASH-SEP','PAYMENT_APPROVAL_PENDING',5000000,'maker','pi-dash-active','PI/ACTIVE','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','IDR',1,'2026-09-02','2026-09-02');
    INSERT INTO payment_proofs(id,payment_instruction_id,bank,reference,transaction_date,amount,uploaded_file_id)
      VALUES('PROOF-DASH','PI-DASH-ACTIVE','BCA','REF-DASH','2026-09-25',5000000,'FILE-DASH');
  `);
}

async function dashboard(DB,actor,url){
  const request=new Request(origin+url,{method:'GET',headers:{Accept:'application/json'}});
  const response=await handleD1OperatingModel({request,env:env(DB)},actor);
  return {response,payload:await response.json()};
}

test('dashboard API is period scoped and returns only the canonical active PI',async()=>{
  const DB=new D1Mock(); seed(DB);
  const result=await dashboard(DB,internal,'/api/operating-model?resource=dashboard&period=2026-09');
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.deepEqual(result.payload.submissions.map((row)=>row.id).sort(),['SUB-DASH-OTHER','SUB-DASH-SEP']);
  assert.equal(result.payload.paymentInstructions.length,1);
  assert.equal(result.payload.paymentInstructions[0].id,'PI-DASH-ACTIVE');
  assert.equal(result.payload.paymentInstructions[0].proof_count,1);
  assert.equal(result.payload.paymentInstructions[0].content_hash.length,64);
  const row=result.payload.submissions.find((item)=>item.id==='SUB-DASH-SEP');
  assert.equal(row.open_exception_count,2,'AUTO_NORMALIZED must not be counted as open');
  assert.equal(row.client_action_count,1);
  assert.equal(result.payload.dashboardMeta.period,'2026-09');
  assert.equal(result.payload.dashboardMeta.truncated,false);
});

test('client dashboard aggregates all assigned scopes without clientId and minimizes PI payload',async()=>{
  const DB=new D1Mock(); seed(DB);
  const result=await dashboard(DB,client,'/api/operating-model?resource=dashboard&period=2026-09');
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.deepEqual(result.payload.submissions.map((row)=>row.id),['SUB-DASH-SEP']);
  assert.equal(result.payload.portfolioSummary.clients,1);
  assert.equal(result.payload.paymentInstructions.length,1);
  const pi=result.payload.paymentInstructions[0];
  assert.equal(pi.id,'PI-DASH-ACTIVE');
  assert.equal('content_hash' in pi,false);
  assert.equal('idempotency_key' in pi,false);
  assert.equal('creator_user_id' in pi,false);
  assert.equal('rejection_reason' in pi,false);
  const submission=result.payload.submissions[0];
  assert.equal('processor_review_note' in submission,false);
  assert.equal('controller_review_note' in submission,false);
  assert.equal('created_by' in submission,false);
  assert.equal('closed_by' in submission,false);
  assert.equal('reopen_reason' in submission,false);
  assert.equal(submission.total_net,5000000);
  assert.equal(submission.state,'PAYMENT_APPROVAL_PENDING');
  assert.deepEqual(result.payload.exceptions,[]);
  assert.deepEqual(result.payload.paymentProofs,[]);
  assert.deepEqual(result.payload.reconciliations,[]);
});

test('dashboard API exposes paging metadata so large periods can be fetched completely',async()=>{
  const DB=new D1Mock(); seed(DB);
  const result=await dashboard(DB,internal,'/api/operating-model?resource=dashboard&period=2026-09&offset=1');
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.dashboardMeta.offset,1);
  assert.equal(result.payload.dashboardMeta.submissionsTotal,2);
  assert.equal(result.payload.submissions.length,1);
  assert.equal(result.payload.dashboardMeta.nextOffset,null);
  assert.equal(result.payload.dashboardMeta.truncated,false);
});

test('dashboard period resource comes from canonical submissions and respects client scope',async()=>{
  const DB=new D1Mock(); seed(DB);
  const result=await dashboard(DB,client,'/api/operating-model?resource=dashboard-periods');
  assert.equal(result.response.status,200,JSON.stringify(result.payload));
  assert.deepEqual(result.payload.periods,['2026-09','2026-08']);
});

test('dashboard UI contracts implement audited P1 and P2 fixes',async()=>{
  const [page,clientHome,tower,header,workspace,billingWorkspace,billingApi,api,css,indexes]=await Promise.all([
    readFile(new URL('../src/app/page.tsx',import.meta.url),'utf8'),
    readFile(new URL('../src/components/ClientHome.tsx',import.meta.url),'utf8'),
    readFile(new URL('../src/components/PayrollControlTower.tsx',import.meta.url),'utf8'),
    readFile(new URL('../src/components/AppHeader.tsx',import.meta.url),'utf8'),
    readFile(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8'),
    readFile(new URL('../src/components/BillingWorkspace.tsx',import.meta.url),'utf8'),
    readFile(new URL('../functions/api/billing.js',import.meta.url),'utf8'),
    readFile(new URL('../src/lib/operating-model-api.ts',import.meta.url),'utf8'),
    readFile(new URL('../src/app/polish.css',import.meta.url),'utf8'),
    readFile(new URL('../migrations/0031_dashboard_query_indexes.sql',import.meta.url),'utf8'),
  ]);
  assert.match(page,/listOperatingPeriods/);
  assert.match(page,/<ClientHome actor=\{actor\} period=\{period\}/);
  assert.match(clientHome,/listOperatingDashboard\(undefined,period\)/);
  assert.match(clientHome,/invalidateOperatingCache\(\)/);
  assert.match(clientHome,/visibleInvoices/);
  assert.match(tower,/\['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING'\]/);
  assert.match(tower,/open_exception_count/);
  assert.match(tower,/proof_count/);
  assert.match(tower,/row\.days!==null&&row\.days<=30/);
  assert.match(tower,/UPCOMING 30 DAYS/);
  assert.match(tower,/No critical blocker/);
  assert.match(tower,/Pay runs with exception/);
  assert.match(tower,/dashboardMeta\?\.truncated/);
  assert.match(header,/proqpay:operating-cache-invalidated/);
  assert.match(header,/invoiceApprovals/);
  assert.match(workspace,/focusSubmissionId/);
  assert.match(workspace,/dashboardStage/);
  assert.match(workspace,/focusSubmissionId=\{focusSubmissionId\}/);
  assert.match(workspace,/focusSection=\{dashboardStage === 'CLOSE' \? 'close' : undefined\}/);
  assert.match(billingWorkspace,/focusSubmissionId/);
  assert.match(billingWorkspace,/getPayRunDetail\(focusSubmissionId\)/);
  assert.match(billingWorkspace,/\/api\/billing\?submissionId=/);
  assert.match(billingWorkspace,/focusedData/);
  assert.match(billingWorkspace,/submission\.period_status === "CLOSED" \|\| closingInvoice \? "close" : "invoice"/);
  assert.match(billingWorkspace,/rows=\{focusedData\.submissions\}/);
  assert.match(billingApi,/s\.id AS submission_id/);
  assert.match(billingApi,/submissionFilter=focusSubmissionId/);
  assert.match(billingApi,/\$\{submissionFilter\.sql\}/);
  assert.match(api,/dashboard-periods/);
  assert.match(api,/while \(true\)/);
  assert.match(api,/dashboardMeta\?\.nextOffset/);
  assert.match(api,/truncated:false/);
  assert.match(css,/theme-dark \.control-kpi/);
  assert.match(css,/dashboard-focus-banner/);
  assert.match(indexes,/idx_dashboard_active_pi_submission/);
});
