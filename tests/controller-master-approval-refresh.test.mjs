import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFixture,roleSession,mockProvider} from './helpers/e2pay-master-fixture.mjs';
import {onRequest as requestApi} from '../functions/api/disbursement-requests.js';
import {onRequest as operationsApi} from '../functions/api/e2pay-operations.js';

const post=(f,headers,body)=>requestApi({request:new Request('https://proqpay.test/api/disbursement-requests',{method:'POST',headers,body:JSON.stringify(body)}),env:f.env});

test('Controller refreshes stale Master balance, approves DR and replays safely without a financial post',async t=>{
 const f=masterFixture();const provider=mockProvider(t);
 // No real execution exists in this scenario: approval must never create one.
 f.database.sqlite.exec("DELETE FROM disbursement_execution_items; DELETE FROM disbursement_executions; UPDATE disbursement_requests SET status='READY' WHERE id='DR-FIX';");
 f.database.sqlite.exec(`INSERT INTO payment_gateway_provider_snapshots(org_id,provider,environment,account_id,merchant_status,balance,refreshed_at) VALUES('ORG-FIX','E2PAY','UAT','PROVIDER-MASTER','ACTIVE',1000000,'2026-01-01T00:00:00Z');
 INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email) VALUES('LIMIT-REFRESH','ORG-FIX','MASTER-FIX','C-FIX','UAT',1000000,1000000,'ACTIVE','processor@test');`);
 const processor=await roleSession(f,'PAYROLL_PROCESSOR');const controller=await roleSession(f,'PAYROLL_CONTROLLER');
 let r=await post(f,processor,{action:'SUBMIT_REQUEST',id:'DR-FIX'});assert.equal(r.status,200,await r.clone().text());
 r=await post(f,controller,{action:'APPROVE_REQUEST',id:'DR-FIX'});assert.equal(r.status,409);assert.equal((await r.json()).code,'E2PAY_FUNDING_PARENT_STALE');
 r=await operationsApi({request:new Request('https://proqpay.test/api/e2pay-operations?resource=account&refresh=1',{headers:controller}),env:f.env});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).account.balance,1e9);
 r=await post(f,controller,{action:'APPROVE_REQUEST',id:'DR-FIX'});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).request.status,'APPROVED');
 r=await post(f,controller,{action:'APPROVE_REQUEST',id:'DR-FIX'});assert.equal(r.status,200);assert.equal((await r.json()).idempotentReplay,true);
 assert.equal(provider.posts().length,0);assert.equal(f.database.sqlite.prepare('SELECT COUNT(*) n FROM disbursement_executions').get().n,0);
 assert.equal(f.database.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='DISBURSEMENT_REQUEST_APPROVED'").get().n,1);
});

test('E2Pay Master PI approval persists encrypted snapshot, checks MFA and never executes payment',async t=>{
 const {handleD1OperatingModel}=await import('../functions/api/operating-model-d1.js');
 const f=masterFixture();const provider=mockProvider(t);
 f.env.SECURITY_MFA_ENFORCEMENT='ENFORCE';
 f.database.sqlite.exec(`INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,payment_period,state,created_by,client_reviewed_by,client_review_decision) VALUES('PS-APPROVAL','ORG-FIX','C-FIX','SP-FIX','TIER_1_PAYMENT_PROCESSING','2026-09','2026-09','CLIENT_APPROVED','seed','client@test','APPROVED');
 INSERT INTO employee_compensation(employee_id,basic_salary,payroll_source_period,imported_gross,imported_deduction,imported_net) VALUES('E-FIX',1000,'2026-09',1000,0,1000);
 INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) VALUES('BANK-APPROVAL','E-FIX','BCA','1234567890',1);
 INSERT INTO payment_gateway_provider_snapshots(org_id,provider,environment,account_id,merchant_status,balance) VALUES('ORG-FIX','E2PAY','UAT','PROVIDER-MASTER','ACTIVE',1000000);
 INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email) VALUES('LIMIT-PI','ORG-FIX','MASTER-FIX','C-FIX','UAT',1000000,1000000,'ACTIVE','processor@test');`);
 const maker={id:'MAKER-PI',orgId:'ORG-FIX',role:'PAYROLL_PROCESSOR',email:'maker@test',permissions:['payment:prepare']};
 const checker={id:'CHECKER-PI',orgId:'ORG-FIX',role:'PAYROLL_CONTROLLER',email:'checker@test',permissions:['payment:approve'],mfaVerifiedAt:new Date().toISOString()};
 const action=(actor,body)=>handleD1OperatingModel({request:new Request('https://proqpay.test/api/operating-model',{method:'POST',headers:{Origin:'https://proqpay.test','Content-Type':'application/json'},body:JSON.stringify(body)}),env:f.env},actor);
 let r=await action(maker,{action:'GENERATE_PAYMENT_INSTRUCTION',submissionId:'PS-APPROVAL'});assert.equal(r.status,201,await r.clone().text());const pi=(await r.json()).paymentInstruction;
 r=await action(maker,{action:'SUBMIT_PAYMENT_INSTRUCTION',paymentInstructionId:pi.id,confirmation:'SUBMIT PI'});assert.equal(r.status,200,await r.clone().text());
 const approval={action:'APPROVE_PAYMENT',paymentInstructionId:pi.id,actionHash:pi.content_hash,confirmation:'KONFIRMASI PAYMENT'};
 r=await action({...checker,mfaVerifiedAt:null},approval);assert.equal(r.status,428,await r.clone().text());
 r=await action(checker,approval);assert.equal(r.status,200,await r.clone().text());
 assert.equal(f.database.sqlite.prepare('SELECT status FROM payment_instructions WHERE id=?').get(pi.id).status,'APPROVED_FOR_PAYMENT');
 assert.equal(f.database.sqlite.prepare("SELECT state FROM payroll_submissions WHERE id='PS-APPROVAL'").get().state,'APPROVED_FOR_PAYMENT');
 assert.equal(f.database.sqlite.prepare('SELECT COUNT(*) n FROM payment_approvals WHERE payment_instruction_id=?').get(pi.id).n,1);
 assert.equal(provider.posts().length,0);
});
