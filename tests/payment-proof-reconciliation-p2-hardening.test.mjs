import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { onRequest as paymentProof } from '../functions/api/payment-proof.js';
import { createSession } from '../functions/api/_account-auth.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');
const request=(body)=>new Request(origin+'/api/operating-model',{
  method:'POST',
  headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},
  body:JSON.stringify(body),
});

class R2Mock {
  constructor(){this.objects=new Map();}
  async put(key,value,options={}){this.objects.set(key,{value,...options});}
  async get(key){
    const object=this.objects.get(key);
    if(!object)return null;
    return {body:object.value,customMetadata:object.customMetadata,
      writeHttpMetadata(headers){if(object.httpMetadata?.contentType)headers.set('Content-Type',object.httpMetadata.contentType);}};
  }
  async delete(key){this.objects.delete(key);}
}

function seed(DB){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-P2','ORG-OTSINDO','P2','PT P2');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-P2','ORG-OTSINDO','CLI-P2','P2','P2 Project','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-P2','CLI-P2','PRJ-P2','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
    INSERT INTO payroll_submissions
      (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
      VALUES('SUB-P2','ORG-OTSINDO','CLI-P2','PRJ-P2','SP-P2','TIER_2_MANAGED_PAYROLL','2026-09','2026-09','REGULAR','MASTER_CURRENT','READY','APPROVED_FOR_PAYMENT','seed');
    INSERT INTO payment_instructions
      (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count)
      VALUES('PI-P2','ORG-OTSINDO','CLI-P2','SUB-P2','APPROVED_FOR_PAYMENT',1000000,'maker','PI-P2-key','PI/P2','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','IDR',1);
    INSERT INTO payment_instruction_lines
      (id,payment_instruction_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
      VALUES('PIL-P2','PI-P2','P2 Employee','BCA','BCA','******7890','cipher','iv','7890','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',1000000);
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES('USR-P2-P','ORG-OTSINDO','P2 Processor','processor.p2@proqpay.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed');
  `);
}

function proofRequest(token,reference='REF-P2'){
  const form=new FormData();
  form.set('paymentInstructionId','PI-P2');
  form.set('bank','BCA');
  form.set('reference',reference);
  form.set('transactionDate','2026-09-24');
  form.set('amount','1000000');
  form.set('file',new File([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34])],'proof.pdf',{type:'application/pdf'}));
  return new Request(origin+'/api/payment-proof',{
    method:'POST',
    headers:{Origin:origin,'Sec-Fetch-Site':'same-origin',Cookie:`proqpay_session=${token}`},
    body:form,
  });
}

test('P2 proof stores immutable evidence fingerprint metadata and rejects duplicate file content',async()=>{
  const DB=new D1Mock(); seed(DB);
  const env={DB,FILES:new R2Mock(),AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-OTSINDO'};
  const session=await createSession(DB,'USR-P2-P',env);

  let response=await paymentProof({request:proofRequest(session.token),env});
  assert.equal(response.status,201,await response.clone().text());
  const proof=DB.sqlite.prepare("SELECT * FROM payment_proofs WHERE payment_instruction_id='PI-P2'").get();
  assert.match(proof.file_sha256,/^[a-f0-9]{64}$/);
  assert.equal(proof.file_size,8);
  assert.equal(proof.mime_type,'application/pdf');
  assert.equal(proof.uploaded_by,'processor.p2@proqpay.test');
  assert.equal(env.FILES.objects.values().next().value.customMetadata.fileSha256,proof.file_sha256);

  response=await paymentProof({request:proofRequest(session.token,'REF-P2-DUP'),env});
  assert.equal(response.status,409,await response.clone().text());
  assert.equal((await response.json()).code,'PAYMENT_PROOF_DUPLICATE_FILE');
});

test('P2 reconciliation fails closed when manual proof and gateway settlement coexist',async()=>{
  const DB=new D1Mock(); seed(DB);
  DB.sqlite.exec(`
    UPDATE payment_instructions SET status='RECONCILIATION' WHERE id='PI-P2';
    UPDATE payroll_submissions SET state='RECONCILIATION' WHERE id='SUB-P2';
    INSERT INTO payment_proofs(id,payment_instruction_id,bank,reference,transaction_date,amount,uploaded_file_id)
      VALUES('PP-P2','PI-P2','BCA','MANUAL-P2','2026-09-24',1000000,'proof-key');
    INSERT INTO payment_gateway_transactions
      (id,org_id,client_id,payment_instruction_id,provider,provider_transaction_id,status,amount,currency,payment_method,idempotency_key,request_hash,created_by)
      VALUES('PGT-P2','ORG-OTSINDO','CLI-P2','PI-P2','E2PAY','GW-P2','SUCCEEDED',1000000,'IDR','DISBURSEMENT','PG-P2-key','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','processor');
  `);
  const controller={id:'USR-C',email:'controller@proqpay.test',role:'PAYROLL_CONTROLLER',permissions:['payment:approve','reconciliation:write']};
  const response=await handleD1OperatingModel({request:request({action:'RECONCILE_PAYMENT',paymentInstructionId:'PI-P2'}),env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO'}},controller);
  assert.equal(response.status,409,await response.clone().text());
  assert.equal((await response.json()).code,'SETTLEMENT_SOURCE_CONFLICT');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM reconciliations WHERE payment_instruction_id='PI-P2'").get().count,0);
});

test('P2 reconciliation writes append-only attempt history and unified PI audit includes proof events',async()=>{
  const DB=new D1Mock(); seed(DB);
  DB.sqlite.exec(`
    UPDATE payment_instructions SET status='PROOF_UPLOADED' WHERE id='PI-P2';
    UPDATE payroll_submissions SET state='PROOF_UPLOADED' WHERE id='SUB-P2';
    INSERT INTO payment_proofs(id,payment_instruction_id,bank,reference,transaction_date,amount,uploaded_file_id,file_sha256,file_size,mime_type,uploaded_by)
      VALUES('PP-P2','PI-P2','BCA','MANUAL-P2','2026-09-24',1000000,'proof-key','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',8,'application/pdf','processor@proqpay.test');
    INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
      VALUES('AUD-P2','ORG-OTSINDO','processor@proqpay.test','PAYROLL_PROCESSOR','PAYMENT_PROOF_UPLOADED','proof audit','payment_proof','PP-P2');
  `);
  const controller={id:'USR-C',email:'controller@proqpay.test',role:'PAYROLL_CONTROLLER',permissions:['reconciliation:write']};
  let response=await handleD1OperatingModel({request:request({action:'RECONCILE_PAYMENT',paymentInstructionId:'PI-P2'}),env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO'}},controller);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM reconciliation_attempts WHERE payment_instruction_id='PI-P2'").get().count,1);
  const attempt=DB.sqlite.prepare("SELECT * FROM reconciliation_attempts WHERE payment_instruction_id='PI-P2'").get();
  assert.equal(attempt.settlement_source,'MANUAL_PROOF');
  assert.equal(attempt.status,'MATCHED');

  response=await handleD1OperatingModel({
    request:new Request(origin+'/api/operating-model?resource=payment-instruction-detail&paymentInstructionId=PI-P2',{method:'GET'}),
    env:{DB,DEFAULT_ORG_ID:'ORG-OTSINDO'},
  },controller);
  const detail=await response.json();
  assert.ok(detail.activity.some((event)=>event.action==='PAYMENT_PROOF_UPLOADED'));
  assert.equal(detail.reconciliationHistory.length,1);
  assert.equal(detail.proofSummary.proof_total,1000000);
});

test('P2 payment history APIs expose pagination and frontend aggregates all pages',async()=>{
  const d1=await read('functions/api/operating-model-d1.js');
  const api=await read('src/lib/operating-model-api.ts');
  const workspace=await read('src/components/OperatingWorkspace.tsx');
  assert.match(d1,/paymentProofsMeta:\{ offset,limit,returned:page\.length,nextOffset:truncated\?offset\+limit:null,truncated \}/);
  assert.match(d1,/reconciliationsMeta:\{ offset,limit,returned:page\.length,nextOffset:truncated\?offset\+limit:null,truncated \}/);
  assert.match(api,/listAllPaginatedOperatingResource/);
  assert.match(api,/limit:'500'/);
  assert.match(workspace,/listAllPaginatedOperatingResource\(resource, clientId\)/);
});
