import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { handleD1OperatingModel } from '../functions/api/operating-model-d1.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const origin='https://proqpay.test';
const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

function seedPaymentInstructionVolume(DB,count=125){
  DB.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name) VALUES('CLI-FINAL','ORG-OTSINDO','FINAL','PT Final Payment UAT');
    INSERT INTO projects(id,org_id,client_id,code,name,created_by)
      VALUES('PRJ-FINAL','ORG-OTSINDO','CLI-FINAL','FINAL','Final Payment Project','seed');
    INSERT INTO client_service_plans(id,client_id,project_id,tier,status,effective_from,created_by)
      VALUES('SP-FINAL','CLI-FINAL','PRJ-FINAL','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');
  `);
  const submission=DB.sqlite.prepare(`INSERT INTO payroll_submissions
    (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,'MASTER_CURRENT','READY','APPROVED_FOR_PAYMENT','seed')`);
  const instruction=DB.sqlite.prepare(`INSERT INTO payment_instructions
    (id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,document_no,content_hash,currency,recipient_count,created_at)
    VALUES(?,?,?,?, 'APPROVED_FOR_PAYMENT',1000000,'maker',?,?,?,'IDR',1,?)`);
  DB.sqlite.exec('BEGIN');
  for(let i=1;i<=count;i+=1){
    const n=String(i).padStart(3,'0');
    const submissionId=`SUB-FINAL-${n}`;
    submission.run(submissionId,'ORG-OTSINDO','CLI-FINAL','PRJ-FINAL','SP-FINAL','TIER_1_PAYMENT_PROCESSING','2026-09','2026-09','REGULAR');
    instruction.run(`PI-FINAL-${n}`,'ORG-OTSINDO','CLI-FINAL',submissionId,`KEY-FINAL-${n}`,`PI/FINAL/${n}`,'a'.repeat(64),`2026-09-24T12:${String(i%60).padStart(2,'0')}:00.000Z`);
  }
  DB.sqlite.exec('COMMIT');
}

test('final Payment Control UAT: payment instruction API paginates without silent 100-row truncation',async()=>{
  const DB=new D1Mock();
  seedPaymentInstructionVolume(DB,125);
  const actor={id:'USR-P',email:'processor@proqpay.test',role:'PAYROLL_PROCESSOR',permissions:['payment:prepare']};
  const env={DB,DEFAULT_ORG_ID:'ORG-OTSINDO'};

  let response=await handleD1OperatingModel({
    request:new Request(origin+'/api/operating-model?resource=payment-instructions&limit=100&offset=0',{method:'GET'}),
    env,
  },actor);
  assert.equal(response.status,200,await response.clone().text());
  let payload=await response.json();
  assert.equal(payload.paymentInstructions.length,100);
  assert.equal(payload.paymentInstructionsMeta.nextOffset,100);
  assert.equal(payload.paymentInstructionsMeta.truncated,true);

  response=await handleD1OperatingModel({
    request:new Request(origin+'/api/operating-model?resource=payment-instructions&limit=100&offset=100',{method:'GET'}),
    env,
  },actor);
  payload=await response.json();
  assert.equal(payload.paymentInstructions.length,25);
  assert.equal(payload.paymentInstructionsMeta.nextOffset,null);
  assert.equal(payload.paymentInstructionsMeta.truncated,false);
});

test('final Payment Control UAT: both workspace and gateway queue aggregate all PI pages',async()=>{
  const api=await read('src/lib/operating-model-api.ts');
  const workspace=await read('src/components/OperatingWorkspace.tsx');
  const gateway=await read('src/components/PaymentGatewayPaymentPanel.tsx');

  assert.match(api,/resource:'payment-instructions'\|'payment-proofs'\|'reconciliations'/);
  assert.match(api,/paymentInstructionsMeta/);
  assert.match(workspace,/resource === 'payment-instructions' \|\| resource === 'payment-proofs' \|\| resource === 'reconciliations'/);
  assert.match(gateway,/listAllPaginatedOperatingResource\('payment-instructions'\)/);
});

test('final Payment Control UAT: page composes PI controls and gateway execution for internal roles',async()=>{
  const page=await read('src/app/page.tsx');
  const workspace=await read('src/components/OperatingWorkspace.tsx');
  const gateway=await read('src/components/PaymentGatewayPaymentPanel.tsx');
  const evidence=await read('src/components/PaymentEvidenceReconciliation.tsx');

  assert.match(page,/view === 'payments'.*OperatingWorkspace mode="payments".*PaymentGatewayPaymentPanel/s);
  assert.match(page,/gatewayCanView = \['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'\]/);
  assert.match(page,/gatewayCanExecute = \['SUPER_ADMIN','PAYROLL_PROCESSOR'\]/);
  assert.match(workspace,/canRecordProof=\{isProcessor\}/);
  assert.match(workspace,/canReconcile=\{isController/);
  assert.match(workspace,/canApprove=\{canApprovePayment && isController\}/);
  assert.match(gateway,/\['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING'\]/);
  assert.match(evidence,/Payment Evidence Register/);
  assert.match(evidence,/RECONCILIATION CONTROL/);
});

test('final Payment Control UAT: backend keeps maker-checker, settlement conflict, evidence integrity, and scope guards',async()=>{
  const edge=await read('functions/api/operating-model.js');
  const d1=await read('functions/api/operating-model-d1.js');
  const proof=await read('functions/api/payment-proof.js');
  const gateway=await read('functions/api/payment-gateway.js');

  assert.match(edge,/PAYMENT_PREPARE_PERMISSION_REQUIRED/);
  assert.match(edge,/PAYMENT_APPROVE_PERMISSION_REQUIRED/);
  assert.match(edge,/PAYMENT_RECONCILE_PERMISSION_REQUIRED/);
  assert.match(edge,/SETTLEMENT_SOURCE_CONFLICT/);
  assert.match(d1,/reconciliation_attempts/);
  assert.match(proof,/PAYMENT_PROOF_DUPLICATE_FILE/);
  assert.match(proof,/fileSha256/);
  assert.match(proof,/canAccessProject\(authorization\.actor, proof\.project_id\)/);
  assert.match(gateway,/PAYMENT_RECIPIENT_COUNT_MISMATCH/);
  assert.match(gateway,/GATEWAY_EXECUTION_UNKNOWN/);
});
