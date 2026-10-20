import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {D1Mock} from './helpers/d1-mock.mjs';
import {applyCanonicalEwaSettlement} from '../functions/api/ewa-canonical-settlement.js';
import {passwordRecord} from '../functions/api/_account-auth.js';
import {onRequest as ewaApi} from '../functions/api/ewa.js';
import {onRequest as drApi} from '../functions/api/disbursement-requests.js';
import {createSession} from '../functions/api/_account-auth.js';

const ui=await readFile(new URL('../src/components/CanonicalDisbursementWorkspace.tsx',import.meta.url),'utf8');
const workspace=await readFile(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
const inbox=await readFile(new URL('../src/components/EwaInbox.tsx',import.meta.url),'utf8');
const execution=await readFile(new URL('../functions/api/disbursement-executions.js',import.meta.url),'utf8');
const reconcile=await readFile(new URL('../functions/api/canonical-transaction-register.js',import.meta.url),'utf8');

function seed(){
 const db=new D1Mock();db.sqlite.exec(`
 INSERT INTO organizations(id,name,code) VALUES('ORG-P0B','Test','P0B');
 INSERT INTO clients(id,org_id,code,name,status) VALUES('C-P0B','ORG-P0B','CLI','Client','ACTIVE');
 INSERT INTO employees(id,org_id,client_id,employee_code,name,status_aktif) VALUES('E-P0B','ORG-P0B','C-P0B','E001','Employee','ACTIVE');
 INSERT INTO ewa_requests(id,org_id,client_id,employee_id,period,amount,status) VALUES('EWA-P0B','ORG-P0B','C-P0B','E-P0B','2026-10',100,'APPROVED');
 INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,created_by)
 VALUES('PPA-P0B','ORG-P0B','C-P0B','E2PAY','UAT','SUB_ACCOUNT','SUB-P0B','ACTIVE','seed');
 INSERT INTO disbursement_requests(id,org_id,client_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,amount,recipient_count,client_reference,correlation_id,idempotency_key,routing_hash,status,approved_by_email,approved_at,created_by_email)
 VALUES('DR-P0B','ORG-P0B','C-P0B','E2PAY','PPA-P0B','SUB-P0B','UAT','EWA','DIRECT_EMPLOYEE','EMPLOYEE','EWA_REQUEST','EWA-P0B',100,1,'REF-EWA-P0B','CORR-P0B','IDEM-P0B','HASH-P0B','APPROVED','controller@test','2026-10-12T00:00:00Z','processor@test');
 INSERT INTO disbursement_executions(id,org_id,client_id,disbursement_request_id,provider,provider_account_registry_id,provider_channel,status,amount,idempotency_key,request_hash,created_by)
 VALUES('DX-P0B','ORG-P0B','C-P0B','DR-P0B','E2PAY','PPA-P0B','CANONICAL_TEST','PROCESSING',100,'DX-IDEM-P0B','DX-HASH-P0B','controller@test');
 INSERT INTO disbursement_request_items(id,disbursement_request_id,sequence_no,source_item_type,source_item_id,beneficiary_type,beneficiary_reference,employee_id,bank_code,beneficiary_name,account_number_ciphertext,account_number_iv,account_number_hash,account_number_last4,beneficiary_hash,amount,client_reference)
 VALUES('DRI-P0B','DR-P0B',1,'EWA_REQUEST','EWA-P0B','EMPLOYEE','E-P0B','E-P0B','BCA','Employee','encrypted','iv','hash','1234','beneficiaryhash',100,'CLIENTREF-DRI');
 INSERT INTO disbursement_execution_items(id,disbursement_execution_id,disbursement_request_item_id,provider,client_ref,beneficiary_name,account_last4,amount,status)
 VALUES('DXI-P0B','DX-P0B','DRI-P0B','E2PAY','CLIENTREF-DRI','Employee','1234',100,'PROCESSING');
 `);return db;
}

test('P0.B UI uses canonical DR API for all three business intents with role-based controls',()=>{
 for(const key of ['DIRECT_EMPLOYEE','CLIENT_ACCOUNT','EWA_REQUEST','SUBMIT_REQUEST','APPROVE_REQUEST','REJECT_REQUEST']) assert.match(ui,new RegExp(key));
 assert.match(ui,/disbursement-executions/);assert.match(ui,/canonical-transaction-register/);
 assert.match(ui,/actor\?\.role==='PAYROLL_PROCESSOR'/);assert.match(ui,/actor\?\.role==='PAYROLL_CONTROLLER'/);
 assert.match(ui,/window\.prompt/);assert.match(ui,/Ketik BAYAR/);
 assert.match(ui,/MFA_STEP_UP_REQUIRED/);assert.match(ui,/window\.confirm/);
 assert.match(workspace,/CanonicalDisbursementWorkspace actor=\{actor\} payrollSources=\{visibleInstructions\}/);
 assert.match(workspace,/executionStrategy==='canonical'/);
 assert.match(workspace,/executionStrategy==='legacy'/);
 assert.match(inbox,/CanonicalDisbursementWorkspace actor=\{actor\} sourceType="EWA_REQUEST"/);
 assert.match(inbox,/role=\{actor\?\.role\|\|""\}/);
 assert.doesNotMatch(inbox,/DisbursementDialog/);
});

test('P0.B source-scoped DR lookup lets payment UI hide legacy gateway for canonical PI',async()=>{
 const db=seed();const pass=await passwordRecord('SomeSecurePass!2026');
 db.sqlite.prepare(`INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by) VALUES('U-P0B2','ORG-P0B','Controller','controller@p0b.test','PAYROLL_CONTROLLER','ACTIVE',?,?,?,0,1,'seed')`).run(pass.hash,pass.salt,pass.iterations);
 const env={DB:db,DEFAULT_ORG_ID:'ORG-P0B',AUTH_MODE:'session',SESSION_SECRET:'p0b-test-session-secret-at-least-32-chars'};
 const session=await createSession(db,'U-P0B2',env);
 const url='https://proqpay.test/api/disbursement-requests?sourceDocumentType=EWA_REQUEST&sourceDocumentId=EWA-P0B';
 const response=await drApi({request:new Request(url,{headers:{Cookie:`proqpay_session=${session.token}`}}),env});
 assert.equal(response.status,200,await response.clone().text());
 const rows=(await response.json()).requests;
 assert.equal(rows.length,1);assert.equal(rows[0].id,'DR-P0B');
 assert.ok(!JSON.stringify(rows).includes('encrypted'));
 const payment=await drApi({request:new Request('https://proqpay.test/api/disbursement-requests?sourceDocumentType=PAYMENT_INSTRUCTION&sourceDocumentId=PI-NONE',{headers:{Cookie:`proqpay_session=${session.token}`}}),env});
 assert.equal((await payment.json()).requests.length,0);
});

test('P0.B EWA legacy manual DISBURSE remains blocked while Processor/Controller can query approved EWA',async()=>{
 const db=seed();const pass=await passwordRecord('SomeSecurePass!2026');
 db.sqlite.prepare(`INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by) VALUES('U-P0B','ORG-P0B','Processor','processor@p0b.test','PAYROLL_PROCESSOR','ACTIVE',?,?,?,0,0,'seed')`).run(pass.hash,pass.salt,pass.iterations);
 const env={DB:db,DEFAULT_ORG_ID:'ORG-P0B',AUTH_MODE:'session',SESSION_SECRET:'p0b-test-session-secret-at-least-32-chars'};
 const session=await createSession(db,'U-P0B',env);
 const response=await ewaApi({request:new Request('https://proqpay.test/api/ewa?status=APPROVED',{headers:{Cookie:`proqpay_session=${session.token}`}}),env});
 assert.equal(response.status,200,await response.clone().text());
 assert.equal((await response.json()).requests[0].id,'EWA-P0B');
 const post=await ewaApi({request:new Request('https://proqpay.test/api/ewa',{method:'POST',headers:{Cookie:`proqpay_session=${session.token}`,Origin:'https://proqpay.test','Content-Type':'application/json'},body:JSON.stringify({action:'DISBURSE',id:'EWA-P0B'})}),env});
 assert.equal(post.status,403);
});

test('P0.B EWA cannot mark paid unless every provider execution item is confirmed SUCCEEDED',async()=>{
 const db=seed();const row={id:'DR-P0B',org_id:'ORG-P0B',source_document_type:'EWA_REQUEST',source_document_id:'EWA-P0B',client_reference:'REF-EWA-P0B'};
 assert.equal((await applyCanonicalEwaSettlement(db,row,'controller@test')).updated,false);
 assert.throws(()=>db.sqlite.exec("UPDATE ewa_requests SET status='DISBURSED',disbursement_source='E2PAY_CANONICAL' WHERE id='EWA-P0B'"),/EWA_CANONICAL_DISBURSEMENT_REQUIRED/);
 db.sqlite.exec("UPDATE disbursement_requests SET status='SETTLED' WHERE id='DR-P0B'; UPDATE disbursement_executions SET status='SUCCEEDED' WHERE id='DX-P0B'");
 assert.equal((await applyCanonicalEwaSettlement(db,row,'controller@test')).updated,false,'unknown provider item must remain blocked');
 db.sqlite.exec("UPDATE disbursement_execution_items SET status='SUCCEEDED' WHERE id='DXI-P0B'");
 assert.equal((await applyCanonicalEwaSettlement(db,row,'controller@test')).updated,true);
 const ewa=db.sqlite.prepare("SELECT * FROM ewa_requests WHERE id='EWA-P0B'").get();
 assert.equal(ewa.status,'DISBURSED');assert.equal(ewa.disbursement_source,'E2PAY_CANONICAL');assert.equal(ewa.disbursement_reference,'REF-EWA-P0B');
 assert.equal((await applyCanonicalEwaSettlement(db,row,'controller@test')).updated,false,'replayed settlement is idempotent');
});

test('P0.B settlement bridge only fires after confirmed execution or MATCHED reconciliation',()=>{
 assert.match(execution,/result\.parentStatus==='SUCCEEDED'\) await applyCanonicalEwaSettlement/);
 assert.match(reconcile,/result\.outcome\.attemptStatus==='MATCHED'\)\{\s*await applyCanonicalEwaSettlement/);
});
