import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFixture,roleSession} from './helpers/e2pay-master-fixture.mjs';
import {encryptAccountNumber} from '../functions/api/payment-instruction-core.js';
import {onRequest} from '../functions/api/disbursement-requests.js';

async function post(f,role,body,mfa=true){return onRequest({env:f.env,request:new Request('https://proqpay.test/api/disbursement-requests',{method:'POST',headers:await roleSession(f,role,{mfa}),body:JSON.stringify(body)})});}
async function fixture(t,count=2){
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Reissue must never call the payment provider'));
 const f=masterFixture();f.database.sqlite.exec("INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by) VALUES('PS-RE','ORG-FIX','C-FIX','SP-FIX','TIER_1_PAYMENT_PROCESSING','2026-11','APPROVED_FOR_PAYMENT','test')");const enc=await encryptAccountNumber('1234567890',f.env.PI_ENCRYPTION_KEY);
 f.database.sqlite.prepare(`INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,content_hash,recipient_count,provider,provider_environment,provider_account_registry_id) VALUES('PI-RE','ORG-FIX','C-FIX','PS-RE','APPROVED_FOR_PAYMENT',?,'processor','PI-RE-IDEM','PI-RE-HASH',?,'E2PAY','UAT','MASTER-FIX')`).run(count*1000,count);
 for(let n=1;n<=count;n++)f.database.sqlite.prepare(`INSERT INTO payment_instruction_lines(id,payment_instruction_id,employee_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount) VALUES(?,'PI-RE','E-FIX','Employee','BCA','BCA','****7890',?,?,'7890',?,1000)`).run('L-RE-'+n,enc.ciphertext,enc.iv,'LH-RE-'+n);
 const r=await post(f,'PAYROLL_PROCESSOR',{action:'CREATE',sourceDocumentType:'PAYMENT_INSTRUCTION',sourceDocumentId:'PI-RE',destinationMode:'DIRECT_EMPLOYEE'});
 assert.equal(r.status,201,await r.clone().text());f.old=(await r.json()).request;fail(f,f.old.id);return f;
}
function fail(f,id){
 f.database.sqlite.prepare("UPDATE disbursement_requests SET status='FAILED' WHERE id=?").run(id);
 f.database.sqlite.prepare(`INSERT INTO disbursement_executions(id,org_id,client_id,disbursement_request_id,provider,provider_account_registry_id,provider_channel,status,amount,idempotency_key,request_hash,created_by) SELECT ?,'ORG-FIX','C-FIX',id,'E2PAY','MASTER-FIX','E2PAY_SDP','FAILED',amount,?,'hash','test' FROM disbursement_requests WHERE id=?`).run('DX-'+id,'DX-IDEM-'+id,id);
 f.database.sqlite.prepare(`INSERT INTO disbursement_execution_items(id,disbursement_execution_id,disbursement_request_item_id,provider,client_ref,beneficiary_name,account_last4,amount,status) SELECT 'XI-'||id,?,id,'E2PAY','EX-'||client_reference,beneficiary_name,account_number_last4,amount,'FAILED' FROM disbursement_request_items WHERE disbursement_request_id=?`).run('DX-'+id,id);
}

test('214-recipient failed DR creates one fresh READY replacement on same PI; historical ledger remains and no approval/payment is replayed',async t=>{
 const f=await fixture(t,214);const before=f.database.sqlite.prepare("SELECT * FROM payment_instructions WHERE id='PI-RE'").get();
 const r=await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:f.old.id,sourceDocumentId:'ATTACK',destinationMode:'CLIENT_ACCOUNT',amount:1});
 assert.equal(r.status,201,await r.clone().text());const next=(await r.json()).request;
 assert.equal(next.status,'READY');assert.equal(next.sourceDocumentId,'PI-RE');assert.equal(next.destinationMode,'DIRECT_EMPLOYEE');assert.equal(next.amount,214000);assert.equal(next.items.length,214);
 assert.notEqual(next.clientReference,f.old.clientReference);
 assert.equal(f.database.sqlite.prepare('SELECT status FROM disbursement_requests WHERE id=?').get(f.old.id).status,'CANCELLED');
 assert.equal(f.database.sqlite.prepare('SELECT status FROM disbursement_executions WHERE disbursement_request_id=?').get(f.old.id).status,'FAILED');
 assert.equal(f.database.sqlite.prepare('SELECT count(*) n FROM disbursement_execution_items WHERE disbursement_execution_id=?').get('DX-'+f.old.id).n,214);
 assert.deepEqual(f.database.sqlite.prepare("SELECT * FROM payment_instructions WHERE id='PI-RE'").get(),before);
 const replay=await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:f.old.id});assert.equal(replay.status,200);assert.equal((await replay.json()).request.id,next.id);
 assert.equal(f.database.sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE action='DISBURSEMENT_REQUEST_REISSUED'").get().n,1);
 assert.equal(f.database.sqlite.prepare('SELECT approved_by_email FROM disbursement_requests WHERE id=?').get(next.id).approved_by_email,null);
 fail(f,next.id);const second=await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:next.id});assert.equal(second.status,201,await second.clone().text());assert.notEqual((await second.json()).request.clientReference,next.clientReference);
});

for(const mutation of ["attempt_count=1","journal_id='J'","provider_transaction_id='TX'","status='UNKNOWN'","status='SUCCEEDED'"]){
 test('Reissue refuses any financial activity: '+mutation,async t=>{const f=await fixture(t);f.database.sqlite.prepare(`UPDATE disbursement_execution_items SET ${mutation} WHERE disbursement_execution_id=?`).run('DX-'+f.old.id);const r=await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:f.old.id});assert.equal(r.status,409);assert.equal((await r.json()).code,'DISBURSEMENT_REISSUE_UNSAFE');assert.equal(f.database.sqlite.prepare('SELECT status FROM disbursement_requests WHERE id=?').get(f.old.id).status,'FAILED');});
}

test('Active lease, missing items, wrong tenant and non-Processor roles cannot reissue',async t=>{
 const f=await fixture(t);
 for(const role of ['SUPER_ADMIN','PAYROLL_CONTROLLER','CLIENT_USER'])assert.equal((await post(f,role,{action:'REISSUE_FAILED',id:f.old.id})).status,403);
 assert.equal((await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:'OTHER-TENANT'})).status,404);
 f.database.sqlite.prepare("UPDATE disbursement_executions SET execution_lock_token='busy',execution_lock_expires_at=datetime('now','+2 minutes') WHERE disbursement_request_id=?").run(f.old.id);
 assert.equal((await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:f.old.id})).status,409);
 f.database.sqlite.prepare('UPDATE disbursement_executions SET execution_lock_token=NULL WHERE disbursement_request_id=?').run(f.old.id);
 f.database.sqlite.prepare('DELETE FROM disbursement_execution_items WHERE disbursement_execution_id=?').run('DX-'+f.old.id);
 assert.equal((await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:f.old.id})).status,409);
});

test('A racing financial attempt leave old DR intact and create no replacement',async t=>{
 const f=await fixture(t);const original=f.database.batch.bind(f.database);let race=false;
 f.database.batch=async statements=>{if(!race&&statements.some(s=>s.statement.sourceSQL.includes("status='CANCELLED'"))){race=true;f.database.sqlite.prepare('UPDATE disbursement_execution_items SET attempt_count=1 WHERE disbursement_execution_id=?').run('DX-'+f.old.id);}return original(statements);};
 const r=await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:f.old.id});assert.equal(r.status,409,await r.clone().text());assert.equal((await r.json()).code,'DISBURSEMENT_REISSUE_STATE_CHANGED');assert.equal(f.database.sqlite.prepare('SELECT status FROM disbursement_requests WHERE id=?').get(f.old.id).status,'FAILED');assert.equal(f.database.sqlite.prepare("SELECT count(*) n FROM disbursement_requests WHERE source_document_id='PI-RE'").get().n,1);
});


test('Replacement must be submitted and requires fresh Controller MFA; Processor cannot approve',async t=>{
 const f=await fixture(t);const r=await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:f.old.id});const next=(await r.json()).request;
 const submitted=await post(f,'PAYROLL_PROCESSOR',{action:'SUBMIT_REQUEST',id:next.id});assert.equal(submitted.status,200,await submitted.clone().text());assert.equal((await submitted.json()).request.status,'PENDING_APPROVAL');
 assert.equal((await post(f,'PAYROLL_PROCESSOR',{action:'APPROVE_REQUEST',id:next.id})).status,403);
 f.env.SECURITY_MFA_ENFORCEMENT='ENFORCE';const approval=await post(f,'PAYROLL_CONTROLLER',{action:'APPROVE_REQUEST',id:next.id},false);assert.equal(approval.status,428,await approval.clone().text());
 assert.equal(f.database.sqlite.prepare('SELECT approved_by_email FROM disbursement_requests WHERE id=?').get(next.id).approved_by_email,null);
});

test('Changed beneficiary snapshot is refused before old request is cancelled',async t=>{
 const f=await fixture(t);f.database.sqlite.prepare("UPDATE disbursement_requests SET status='DRAFT' WHERE id=?").run(f.old.id);f.database.sqlite.prepare("UPDATE disbursement_request_items SET beneficiary_hash='changed' WHERE disbursement_request_id=?").run(f.old.id);f.database.sqlite.prepare("UPDATE disbursement_requests SET status='FAILED' WHERE id=?").run(f.old.id);
 const r=await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:f.old.id});assert.equal(r.status,409);assert.equal((await r.json()).code,'DISBURSEMENT_REISSUE_SNAPSHOT_CHANGED');assert.equal(f.database.sqlite.prepare('SELECT status FROM disbursement_requests WHERE id=?').get(f.old.id).status,'FAILED');
});

test('Outstanding reservation must be released before reissue',async t=>{
 const f=await fixture(t);f.database.sqlite.exec("INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email) VALUES('LR','ORG-FIX','MASTER-FIX','C-FIX','UAT',10000,10000,'ACTIVE','processor@test')");f.database.sqlite.prepare("INSERT INTO e2pay_disbursement_request_limit_usage(id,org_id,limit_request_id,provider_account_registry_id,disbursement_request_id,reserved_amount,status) VALUES('LU','ORG-FIX','LR','MASTER-FIX',?,2000,'RESERVED')").run(f.old.id);
 const r=await post(f,'PAYROLL_PROCESSOR',{action:'REISSUE_FAILED',id:f.old.id});assert.equal(r.status,409);assert.equal((await r.json()).code,'DISBURSEMENT_REISSUE_UNSAFE');
});
