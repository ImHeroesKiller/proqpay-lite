import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordRecord } from '../functions/api/_account-auth.js';
import { onRequest as employeeLogin } from '../functions/api/employee/login.js';
import { onRequest as employeeEwa } from '../functions/api/employee/ewa.js';
import { onRequest as issueCredentials } from '../functions/api/employee-credentials.js';
import { onRequest as opsLogin } from '../functions/api/login.js';
import { onRequest as adminEwa } from '../functions/api/ewa.js';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const request=(path,options={})=>new Request(origin+path,{
  ...options,
  headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',...(options.headers||{})},
});

const today=new Date();
const period=`${today.getUTCFullYear()}-${String(today.getUTCMonth()+1).padStart(2,'0')}`;
const paymentDate=`${period}-20`;

async function addUser(DB,{id,email,role='SUPER_ADMIN',password='NativeCloudflare!2026',paymentApprover=1}){
  const record=await passwordRecord(password);
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE',?,?,?,0,?,'seed')`).run(
      id,'ORG-OTSINDO',id,email,role,record.hash,record.salt,record.iterations,paymentApprover,
    );
}

async function loginOps(DB,email,password='NativeCloudflare!2026'){
  const response=await opsLogin({
    request:request('/api/login',{method:'POST',body:JSON.stringify({email,password})}),
    env:{DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'},
  });
  assert.equal(response.status,200,await response.clone().text());
  return response.headers.get('set-cookie').split(';')[0];
}

async function op(DB,actor,body){
  const response=await handleD1OperatingModel({
    request:request('/api/operating-model',{method:'POST',body:JSON.stringify(body)}),
    env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO',PI_ENCRYPTION_KEY:'uat-native-cloudflare-key-32-bytes-minimum'},
  },actor);
  return {response,payload:await response.clone().json()};
}

test('Final integrated Employee Services UAT: ESS submission -> approval -> disbursement -> payroll deduction -> PI -> reconciliation -> REPAID',async()=>{
  const DB=new D1Mock();

  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-OTSINDO','ProQPay UAT','PROQPAY');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-ES-FINAL','ORG-OTSINDO','ESFINAL','PT Employee Services Final','ACTIVE');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ-ES-FINAL','ORG-OTSINDO','CLI-ES-FINAL','ESFINAL','Employee Services Final','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-ES-FINAL','CLI-ES-FINAL','PRJ-ES-FINAL','TIER_2_MANAGED_PAYROLL','ACTIVE','2025-01-01','seed');

    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif,email)
      VALUES('EMP-ES-FINAL','ORG-OTSINDO','CLI-ES-FINAL','PRJ-ES-FINAL','ES-FINAL-001','Employee Final UAT','ACTIVE','employee.final@proqpay.test');
    INSERT INTO employee_contracts(id,employee_id,join_date,is_current)
      VALUES('CTR-ES-FINAL','EMP-ES-FINAL','2025-01-01',1);
    INSERT INTO employee_assignments(id,employee_id,position,is_current)
      VALUES('ASG-ES-FINAL','EMP-ES-FINAL','Operator',1);
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
      VALUES('BANK-ES-FINAL','EMP-ES-FINAL','BCA','1234567890',1);
    INSERT INTO employee_compensation(employee_id,basic_salary,imported_gross,imported_net,payroll_source_period,payroll_components)
      VALUES('EMP-ES-FINAL',5000000,5500000,5000000,'${period}','{"basicSalary":5500000,"taxDeduction":500000}');
    INSERT INTO ewa_policies(id,org_id,client_id,enabled,fee_rate,min_fee,min_fee_amount,max_percent,max_tenor_months,min_days_worked,min_tenure_months,min_tenure_days)
      VALUES('EWA-POL-FINAL','ORG-OTSINDO','CLI-ES-FINAL',1,0.03,50000,1750000,1,1,0,0,0);
  `);

  await addUser(DB,{id:'USR-EWA-APPROVER',email:'ewa.approver@proqpay.test'});
  await addUser(DB,{id:'USR-EWA-DISBURSER',email:'ewa.disburser@proqpay.test'});
  await addUser(DB,{id:'USR-PROC',email:'processor.final@proqpay.test',role:'PAYROLL_PROCESSOR',paymentApprover:0});
  await addUser(DB,{id:'USR-CTRL',email:'controller.final@proqpay.test',role:'PAYROLL_CONTROLLER',paymentApprover:1});

  const approverCookie=await loginOps(DB,'ewa.approver@proqpay.test');
  const disburserCookie=await loginOps(DB,'ewa.disburser@proqpay.test');

  const issued=await issueCredentials({
    request:request('/api/employee-credentials',{method:'POST',headers:{Cookie:approverCookie},body:JSON.stringify({action:'ISSUE',limit:10})}),
    env:{DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'},
  });
  assert.equal(issued.status,200,await issued.clone().text());
  const issuedPayload=await issued.json();
  const employeePassword=issuedPayload.issued.find((row)=>row.employeeId==='EMP-ES-FINAL')?.password;
  assert.ok(employeePassword,'employee credential must be issued');
  DB.sqlite.prepare('UPDATE employee_credentials SET must_change_password=0 WHERE employee_id=?').run('EMP-ES-FINAL');

  const employeeLoginResponse=await employeeLogin({
    request:request('/api/employee/login',{method:'POST',body:JSON.stringify({emp_id:'ES-FINAL-001',password:employeePassword})}),
    env:{DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'},
  });
  assert.equal(employeeLoginResponse.status,200,await employeeLoginResponse.clone().text());
  const employeeSession=await employeeLoginResponse.json();
  assert.ok(employeeSession.token);

  const before=await employeeEwa({
    request:request('/api/employee/ewa',{headers:{Authorization:`Bearer ${employeeSession.token}`}}),
    env:{DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'},
  });
  assert.equal(before.status,200,await before.clone().text());
  const beforePayload=await before.json();
  assert.equal(beforePayload.eligible,true,JSON.stringify(beforePayload));
  assert.ok(beforePayload.plafond>=100000);

  const submit=await employeeEwa({
    request:request('/api/employee/ewa',{
      method:'POST',
      headers:{Authorization:`Bearer ${employeeSession.token}`},
      body:JSON.stringify({action:'SUBMIT',amount:100000,method:'SALARY_ACCOUNT',agreed:true,note:'Final integrated UAT'}),
    }),
    env:{DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'},
  });
  assert.equal(submit.status,200,await submit.clone().text());
  const submitted=(await submit.json()).request;
  assert.equal(submitted.status,'SUBMITTED');
  assert.equal(submitted.destination_bank_name,'BCA');
  assert.equal(submitted.destination_account_last4,'7890');

  let response=await adminEwa({
    request:request('/api/ewa',{method:'POST',headers:{Cookie:approverCookie},body:JSON.stringify({id:submitted.id,action:'APPROVE',note:'Approved in final integrated UAT'})}),
    env:{DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'},
  });
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(DB.sqlite.prepare('SELECT status FROM ewa_requests WHERE id=?').get(submitted.id).status,'APPROVED');

  response=await adminEwa({
    request:request('/api/ewa',{method:'POST',headers:{Cookie:approverCookie},body:JSON.stringify({id:submitted.id,action:'DISBURSE',source:'BANK_TRANSFER',reference:'UAT-SAME-ACTOR',transactionDate:paymentDate})}),
    env:{DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'},
  });
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,'EWA_SOD_REQUIRED');

  response=await adminEwa({
    request:request('/api/ewa',{method:'POST',headers:{Cookie:disburserCookie},body:JSON.stringify({id:submitted.id,action:'DISBURSE',source:'BANK_TRANSFER',reference:'UAT-FINAL-001',transactionDate:paymentDate})}),
    env:{DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'},
  });
  assert.equal(response.status,200,await response.clone().text());
  const disbursed=DB.sqlite.prepare('SELECT * FROM ewa_requests WHERE id=?').get(submitted.id);
  assert.equal(disbursed.status,'DISBURSED');
  assert.equal(disbursed.disbursement_reference,'UAT-FINAL-001');

  const processor={id:'USR-PROC',email:'processor.final@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:['submission:write','payroll:write','payment:prepare']};
  const controller={id:'USR-CTRL',email:'controller.final@proqpay.test',role:'PAYROLL_CONTROLLER',permissions:['payment:approve','reconciliation:write']};
  const client={id:'USR-CLIENT',email:'client.final@proqpay.test',role:'CLIENT_USER',permissions:[],clientIds:['CLI-ES-FINAL'],projectIds:['PRJ-ES-FINAL']};

  const created=await op(DB,processor,{
    action:'CREATE_PAY_RUN',clientId:'CLI-ES-FINAL',projectId:'PRJ-ES-FINAL',servicePlanId:'SP-ES-FINAL',
    period,paymentPeriod:period,paymentDate,runType:'REGULAR',sourceMode:'MASTER_CURRENT',
  });
  assert.equal(created.response.status,201,JSON.stringify(created.payload));
  const submissionId=created.payload.submission.id;

  let step=await op(DB,processor,{
    action:'UPDATE_PAY_RUN_LINE',submissionId,employeeId:'EMP-ES-FINAL',
    grossAmount:5500000,deductionAmount:500000,netAmount:5000000,included:true,
    changeReason:'Final integrated Employee Services UAT line control',
    components:{basicSalary:5500000,taxDeduction:500000},
  });
  assert.equal(step.response.status,200,JSON.stringify(step.payload));

  step=await op(DB,processor,{action:'FINALIZE_PAY_RUN_INPUT',submissionId,confirmation:'DATA PAYROLL FINAL'});
  assert.equal(step.response.status,200,JSON.stringify(step.payload));
  const line=DB.sqlite.prepare('SELECT net_amount,deduction_amount,components FROM payroll_run_lines WHERE submission_id=? AND employee_id=?').get(submissionId,'EMP-ES-FINAL');
  assert.equal(line.net_amount,4850000);
  assert.equal(line.deduction_amount,650000);
  const lineComponents=JSON.parse(line.components);
  assert.equal(lineComponents.ewaRepayment,-100000);
  assert.equal(lineComponents.ewaFee,-50000);
  assert.equal(DB.sqlite.prepare('SELECT status,payroll_submission_id FROM ewa_requests WHERE id=?').get(submitted.id).status,'REPAYING');

  step=await op(DB,processor,{action:'TRANSITION_SUBMISSION',submissionId,toState:'SUBMITTED'});
  assert.equal(step.response.status,200,JSON.stringify(step.payload));
  step=await op(DB,processor,{action:'ADVANCE_PAY_RUN',submissionId,command:'VALIDATE',reviewConfirmed:true});
  assert.equal(step.response.status,200,JSON.stringify(step.payload));
  step=await op(DB,processor,{action:'ADVANCE_PAY_RUN',submissionId,command:'FINALIZE_PAYROLL',reviewConfirmed:true,reviewNote:'Final integrated UAT'});
  assert.equal(step.response.status,200,JSON.stringify(step.payload));

  step=await op(DB,controller,{action:'TRANSITION_SUBMISSION',submissionId,toState:'CLIENT_APPROVAL_PENDING',reviewConfirmed:true,reviewNote:'Controller review final integrated UAT'});
  assert.equal(step.response.status,200,JSON.stringify(step.payload));
  step=await op(DB,client,{action:'CLIENT_APPROVE_PAYROLL',submissionId,reviewConfirmed:true,confirmation:'SETUJUI PAYROLL',reviewNote:'Client final integrated UAT approval'});
  assert.equal(step.response.status,200,JSON.stringify(step.payload));

  step=await op(DB,processor,{action:'GENERATE_PAYMENT_INSTRUCTION',submissionId});
  assert.equal(step.response.status,201,JSON.stringify(step.payload));
  const paymentInstruction=step.payload.paymentInstruction;
  const piLine=DB.sqlite.prepare('SELECT amount FROM payment_instruction_lines WHERE payment_instruction_id=? AND employee_id=?').get(paymentInstruction.id,'EMP-ES-FINAL');
  assert.equal(piLine.amount,4850000,'PI must use post-EWA net');

  step=await op(DB,processor,{action:'SUBMIT_PAYMENT_INSTRUCTION',paymentInstructionId:paymentInstruction.id,confirmation:'SUBMIT PI'});
  assert.equal(step.response.status,200,JSON.stringify(step.payload));
  step=await op(DB,controller,{
    action:'APPROVE_PAYMENT',paymentInstructionId:paymentInstruction.id,
    actionHash:paymentInstruction.content_hash,confirmation:'KONFIRMASI PAYMENT',
  });
  assert.equal(step.response.status,200,JSON.stringify(step.payload));

  DB.sqlite.prepare(`INSERT INTO payment_proofs
    (id,payment_instruction_id,bank,reference,transaction_date,amount,uploaded_file_id,file_sha256,file_size,mime_type,uploaded_by)
    VALUES('PP-ES-FINAL',?,'BCA','PAY-UAT-FINAL',?,?, 'r2://uat-final-proof','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',128,'application/pdf','processor.final@proqpay.test')`)
    .run(paymentInstruction.id,paymentDate,4850000);
  DB.sqlite.prepare("UPDATE payment_instructions SET status='PROOF_UPLOADED' WHERE id=?").run(paymentInstruction.id);
  DB.sqlite.prepare("UPDATE payroll_submissions SET state='PROOF_UPLOADED' WHERE id=?").run(submissionId);

  step=await op(DB,controller,{action:'RECONCILE_PAYMENT',paymentInstructionId:paymentInstruction.id});
  assert.equal(step.response.status,200,JSON.stringify(step.payload));
  assert.equal(step.payload.reconciliation.status,'MATCHED');

  const finalEwa=DB.sqlite.prepare('SELECT status FROM ewa_requests WHERE id=?').get(submitted.id);
  assert.equal(finalEwa.status,'REPAID');
  const auditActions=DB.sqlite.prepare("SELECT action FROM audit_logs WHERE entity='ewa_request' AND entity_id=? ORDER BY rowid").all(submitted.id).map((row)=>row.action);
  assert.ok(auditActions.includes('EWA_SUBMITTED'));
  assert.ok(auditActions.includes('EWA_APPROVED'));
  assert.ok(auditActions.includes('EWA_DISBURSED'));
  assert.ok(auditActions.includes('EWA_REPAID_RECONCILED'));

  const after=await employeeEwa({
    request:request('/api/employee/ewa',{headers:{Authorization:`Bearer ${employeeSession.token}`}}),
    env:{DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'},
  });
  assert.equal(after.status,200,await after.clone().text());
  const afterPayload=await after.json();
  assert.equal(afterPayload.app,null,'repaid request must no longer be an open request');
  assert.equal(afterPayload.history[0].status,'REPAID');
});
