import assert from 'node:assert/strict';
import test from 'node:test';
import {D1Mock} from './helpers/d1-mock.mjs';
import {handleD1OperatingModel} from '../functions/api/operating-model-d1.js';
import {derivePayrollNextAction} from '../src/lib/payroll-next-action-core.js';
const actor={id:'PROCESSOR',email:'processor@example.test',role:'PAYROLL_PROCESSOR',permissions:['submission:write','payroll:write']};
function fixture({status='IMPORTED',batchSubmission='SUB-NP',org='ORG-OTSINDO',sourceMode='UPLOAD_FINAL',resolution='NO_PAY_THIS_PERIOD'}={}){
 const DB=new D1Mock();
 DB.sqlite.exec(`
 INSERT INTO clients(id,org_id,code,name) VALUES('C-NP','ORG-OTSINDO','NP','No Pay UAT');
 INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('P-NP','ORG-OTSINDO','C-NP','NP','UAT','test');
 INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
 VALUES('SP-NP','C-NP','P-NP','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','test');
 INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,source_mode,input_status,state,created_by)
 VALUES('SUB-NP','ORG-OTSINDO','C-NP','P-NP','SP-NP','TIER_2_MANAGED_PAYROLL','2026-11','2026-11','${sourceMode}','PENDING','EXCEPTION_FOUND','test');
 INSERT INTO payroll_upload_batches(id,org_id,submission_id,original_filename,r2_object_key,file_sha256,uploaded_by,status)
 VALUES('B-NP','${org}','${batchSubmission}','uat.xlsx','uat/np','${'a'.repeat(64)}','client@example.test','${status}');
 `);
 const employee=DB.sqlite.prepare("INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif) VALUES(?,'ORG-OTSINDO','C-NP','P-NP',?,?,'ACTIVE')");
 const bank=DB.sqlite.prepare("INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) VALUES(?,?,'PERMATA','701075327',1)");
 const line=DB.sqlite.prepare("INSERT INTO payroll_run_lines(id,submission_id,employee_id,employee_code,employee_name,bank_name,account_last4,gross_amount,deduction_amount,net_amount,components,source,included) VALUES(?,'SUB-NP',?,?,?,'PERMATA','5327',15000,0,15000,'{}','UPLOAD_FINAL',1)");
 for(let i=1;i<=203;i++){
  const id=`E-NP-${i}`;employee.run(id,id,`Dummy ${i}`);bank.run(`BANK-${id}`,id);
  if(i<=200)line.run(`L-${id}`,id,id,`Dummy ${i}`);
  else {
   DB.sqlite.prepare('INSERT INTO payroll_intake_missing_resolutions(id,batch_id,employee_id,resolution,resolved_by) VALUES(?,?,?,?,?)').run(`R-${id}`,'B-NP',id,resolution,'client@example.test');
   DB.sqlite.prepare("INSERT INTO payroll_exceptions(id,submission_id,employee_id,category,severity,status,reason) VALUES(?,'SUB-NP',?,'SYSTEM_EMPLOYEE_MISSING','CRITICAL','OPEN','Missing staff')").run(`EX-${id}`,id);
  }
 }
 return DB;
}
async function action(DB,body){
 const response=await handleD1OperatingModel({request:new Request('https://proqpay.test/api/operating-model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO',PI_ENCRYPTION_KEY:'no-pay-readiness-test-key-at-least-thirty-two'}},actor);
 return {status:response.status,body:await response.json()};
}
const finalize=DB=>action(DB,{action:'FINALIZE_PAY_RUN_INPUT',submissionId:'SUB-NP',confirmation:'DATA PAYROLL FINAL'});

test('200 recipients and 3 confirmed no-pay staff finalize and validate without manual exception acceptance',async()=>{
 const DB=fixture();try {
  const result=await finalize(DB);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.recipients,200);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM payroll_exceptions WHERE status='OPEN'").get().n,0);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM payroll_exceptions WHERE status='AUTO_NORMALIZED'").get().n,3);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM employees WHERE status_aktif='ACTIVE'").get().n,203);
  assert.equal(DB.sqlite.prepare("SELECT SUM(net_amount) n FROM payroll_run_lines WHERE included=1").get().n,3000000);
  const next=derivePayrollNextAction({role:'PAYROLL_PROCESSOR',state:'EXCEPTION_FOUND',blockingCount:0,inputStatus:'READY',sourceMode:'UPLOAD_FINAL',permissions:actor.permissions});
  assert.equal(next.workflowCommand,'ADVANCE_VALIDATE');
  const validated=await action(DB,{action:'ADVANCE_PAY_RUN',submissionId:'SUB-NP',command:'VALIDATE',reviewConfirmed:true});
  assert.equal(validated.status,200,JSON.stringify(validated.body));assert.equal(validated.body.submission.state,'VALIDATED');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM payment_instructions').get().n,0);
 }finally{DB.sqlite.close();}
});
for(const [name,options] of [
 ['unconfirmed source',{status:'RECEIVED'}],['cancelled source',{status:'CANCELLED'}],
 ['another run or period',{batchSubmission:'SUB-OTHER'}],['another organization',{org:'ORG-OTHER'}],
 ['master-created run',{sourceMode:'MASTER_CURRENT'}],['unspecified OTHER decision',{resolution:'OTHER'}],
])test(`${name} cannot suppress missing active staff`,async()=>{
 const DB=fixture(options);try{const result=await finalize(DB);assert.equal(result.status,409);assert.equal(result.body.code,'PAY_RUN_INPUT_CONTROL_INVALID');assert.match(result.body.error,/3 karyawan aktif/);}finally{DB.sqlite.close();}
});
test('confirmed no-pay decisions do not suppress a bank error in an included recipient',async()=>{
 const DB=fixture();try{
  DB.sqlite.prepare("UPDATE employee_bank_accounts SET account_no='' WHERE employee_id='E-NP-1'").run();
  const result=await finalize(DB);assert.equal(result.status,409);assert.equal(result.body.code,'PAY_RUN_INPUT_CONTROL_INVALID');
 }finally{DB.sqlite.close();}
});
