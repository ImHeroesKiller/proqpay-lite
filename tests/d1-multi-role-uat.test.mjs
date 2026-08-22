import assert from 'node:assert/strict';
import test from 'node:test';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const request=(body)=>new Request(`${origin}/api/operating-model`,{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body:JSON.stringify(body)});
const env=(DB)=>({DB,DEFAULT_ORG_ID:'ORG-OTSINDO',PI_ENCRYPTION_KEY:'uat-native-cloudflare-key-32-bytes-minimum'});

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-UAT','ORG-OTSINDO','UAT','PT UAT');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by) VALUES('PRJ-UAT','ORG-OTSINDO','CLI-UAT','UAT','Project UAT','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-UAT','CLI-UAT','PRJ-UAT','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
    INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif) VALUES
      ('EMP-1','ORG-OTSINDO','CLI-UAT','PRJ-UAT','E1','Ani','ACTIVE');
    INSERT INTO employee_compensation(employee_id,basic_salary) VALUES('EMP-1',5000000);
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) VALUES('BANK-1','EMP-1','BCA','1234567890',1);
  `);
}

async function action(DB,actor,body){
  const response=await handleD1OperatingModel({request:request(body),env:env(DB)},actor);
  return {response,payload:await response.json()};
}

const processor={id:'USR-P',email:'processor@test.id',role:'PAYROLL_PROCESSOR',permissions:[]};
const controller={id:'USR-C',email:'controller@test.id',role:'PAYROLL_CONTROLLER',permissions:['payment:prepare']};
const client={id:'USR-CL',email:'client@test.id',role:'CLIENT_USER',clientIds:['CLI-UAT'],projectIds:['PRJ-UAT'],permissions:[]};
const outsider={id:'USR-O',email:'outside@test.id',role:'CLIENT_USER',clientIds:['CLI-OTHER'],projectIds:['PRJ-OTHER'],permissions:[]};

async function createReadyRun(DB){
  const created=await action(DB,processor,{action:'CREATE_PAY_RUN',clientId:'CLI-UAT',projectId:'PRJ-UAT',servicePlanId:'SP-UAT',period:'2026-08',paymentPeriod:'2026-08',paymentDate:'2026-08-25',runType:'REGULAR',sourceMode:'MASTER_CURRENT'});
  assert.equal(created.response.status,201,JSON.stringify(created.payload));
  const id=created.payload.submission.id;
  const finalized=await action(DB,processor,{action:'FINALIZE_PAY_RUN_INPUT',submissionId:id,confirmation:'DATA PAYROLL FINAL'});
  assert.equal(finalized.response.status,200,JSON.stringify(finalized.payload));
  return id;
}

test('multi-role UAT enforces client scope and payroll responsibilities',async()=>{
  const DB=new D1Mock(); seed(DB);
  const id=await createReadyRun(DB);

  const deniedScope=await action(DB,outsider,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'SUBMITTED'});
  assert.equal(deniedScope.response.status,403,'client di luar scope harus ditolak');

  const clientSubmit=await action(DB,client,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'SUBMITTED'});
  assert.equal(clientSubmit.response.status,200,JSON.stringify(clientSubmit.payload));

  const processorValidate=await action(DB,processor,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'INGESTING'});
  assert.equal(processorValidate.response.status,200,JSON.stringify(processorValidate.payload));

  const clientProcessorStep=await action(DB,client,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'AI_VALIDATING'});
  assert.equal(clientProcessorStep.response.status,403,'client tidak boleh mengambil alih processor step');

  const controllerProcessorStep=await action(DB,controller,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'AI_VALIDATING'});
  assert.equal(controllerProcessorStep.response.status,403,'controller tidak boleh mengambil alih processor step');

  const processorContinue=await action(DB,processor,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'AI_VALIDATING'});
  assert.equal(processorContinue.response.status,200,JSON.stringify(processorContinue.payload));
  const validated=await action(DB,processor,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'VALIDATED'});
  assert.equal(validated.response.status,200,JSON.stringify(validated.payload));
  const standardized=await action(DB,processor,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'STANDARDIZED'});
  assert.equal(standardized.response.status,200,JSON.stringify(standardized.payload));

  const withoutReview=await action(DB,processor,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'CONTROLLER_REVIEW'});
  assert.equal(withoutReview.response.status,409,'processor review confirmation wajib');
  const reviewed=await action(DB,processor,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'CONTROLLER_REVIEW',reviewConfirmed:true,reviewNote:'Processor review complete'});
  assert.equal(reviewed.response.status,200,JSON.stringify(reviewed.payload));

  const processorCannotApprove=await action(DB,processor,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'DATA_APPROVED',reviewConfirmed:true});
  assert.equal(processorCannotApprove.response.status,403,'processor tidak boleh melakukan controller approval');
  const controllerApprove=await action(DB,controller,{action:'TRANSITION_SUBMISSION',submissionId:id,toState:'DATA_APPROVED',reviewConfirmed:true,reviewNote:'Controller approved'});
  assert.equal(controllerApprove.response.status,200,JSON.stringify(controllerApprove.payload));
});
