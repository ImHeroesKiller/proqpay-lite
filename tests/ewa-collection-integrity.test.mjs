import test from 'node:test';
import assert from 'node:assert/strict';
import {D1Mock} from './helpers/d1-mock.mjs';
import {createSession} from '../functions/api/_account-auth.js';
import {createEmployeeSession} from '../functions/api/_employee-auth.js';
import {applyEwaRepayments,markEwaRepaid} from '../functions/api/_ewa.js';
import {onRequest as employeeEwa} from '../functions/api/employee/ewa.js';
import {onRequest as approval} from '../functions/api/ewa.js';
import {onRequest as drApi} from '../functions/api/disbursement-requests.js';
import {onRequest as limitApi} from '../functions/api/e2pay-disbursement-limits.js';
import {masterFixture,roleSession} from './helpers/e2pay-master-fixture.mjs';
import {activateGatewaySecureSettings} from '../functions/api/payment-gateway-settings-store.js';

function fixture(status='DISBURSED',components='{}'){
 const DB=new D1Mock();DB.sqlite.exec(`
 INSERT INTO organizations(id,name,code) VALUES('O','Audit test','AUDIT');
 INSERT INTO clients(id,org_id,name,code) VALUES('C','O','Synthetic client','C');
 INSERT INTO projects(id,org_id,client_id,name,code,created_by) VALUES('P','O','C','Project','P','seed');
 INSERT INTO employees(id,org_id,client_id,project_id,name,employee_code,status_aktif) VALUES('E','O','C','P','Synthetic employee','TEST','ACTIVE');
 INSERT INTO employee_compensation(employee_id,basic_salary,imported_net,payroll_source_period) VALUES('E',1000000,1000000,'2026-01');
 INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary) VALUES('B','E','BCA','1234567890',1);
 INSERT INTO employee_credentials(employee_id,password_hash,password_salt,must_change_password) VALUES('E','unused','unused',0);
 INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('SP','C','TIER_2_MANAGED_PAYROLL','ACTIVE','2026-01-01','seed');
 INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,state,created_by,run_type) VALUES
 ('S1','O','C','P','SP','TIER_2_MANAGED_PAYROLL','2026-11','DRAFT','seed','REGULAR'),
 ('S2','O','C','P','SP','TIER_2_MANAGED_PAYROLL','2026-11','DRAFT','seed','OFF_CYCLE');
 INSERT INTO payroll_run_lines(id,submission_id,employee_id,employee_name,source,gross_amount,deduction_amount,net_amount,included) VALUES
 ('L1','S1','E','Synthetic','TEST',1000000,0,1000000,1),('L2','S2','E','Synthetic','TEST',1000000,0,1000000,1);
 INSERT INTO ewa_employee_settings(employee_id,org_id,client_id,enabled,updated_by,change_reason) VALUES('E','O','C',1,'seed','Audit only');
 INSERT INTO app_users(id,org_id,name,email,role,status,must_change_password,created_by,password_hash,password_salt,password_iterations) VALUES('CLIENT','O','Synthetic','client@example.test','CLIENT_USER','ACTIVE',0,'seed','unused','unused',100000);
 INSERT INTO user_client_scopes(user_id,client_id) VALUES('CLIENT','C');`);
 DB.sqlite.prepare('UPDATE payroll_run_lines SET components=?').run(components);
 DB.sqlite.prepare(`INSERT INTO ewa_requests(id,org_id,client_id,employee_id,period,amount,fee,repayment,status,plafond_snapshot,days_worked_snapshot,tenure_months_snapshot) VALUES('R','O','C','E','2026-11',200000,50000,250000,?,300000,15,12)`).run(status);
 const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'O',SESSION_SECRET:'synthetic-audit-session-key-at-least-32'};
 return {DB,env};
}
const req=(path,headers,body)=>new Request('https://proqpay.test'+path,{method:'POST',headers:{Origin:'https://proqpay.test','Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('parallel regular/off-cycle finalization claims one EWA exactly once',async()=>{
 const {DB}=fixture();const originalBatch=DB.batch.bind(DB);let queue=Promise.resolve();
 DB.batch=ops=>{const result=queue.then(()=>originalBatch(ops));queue=result.catch(()=>{});return result;};
 await Promise.all([applyEwaRepayments(DB,'S1'),applyEwaRepayments(DB,'S2')]);
 const lines=DB.sqlite.prepare('SELECT submission_id,net_amount FROM payroll_run_lines ORDER BY submission_id').all();
 assert.deepEqual(lines.map(l=>Number(l.net_amount)),[750000,1000000]);
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM ewa_requests WHERE status='REPAYING'").get().n,1);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM ewa_repayment_allocations').get().n,1);
});

test('sewaRumah is unrelated to EWA and unverified repayment remains outstanding',async()=>{
 const {DB}=fixture('DISBURSED','{"sewaRumah":0}');
 await applyEwaRepayments(DB,'S1');
 const line=DB.sqlite.prepare("SELECT net_amount,deduction_amount FROM payroll_run_lines WHERE id='L1'").get();
 assert.equal(line.net_amount,750000);assert.equal(line.deduction_amount,250000);
 // Simulates the caller's completed reconciliation of the full payroll line.
 await markEwaRepaid(DB,'S1');
 assert.equal(DB.sqlite.prepare("SELECT status FROM ewa_requests WHERE id='R'").get().status,'REPAYING');
});

test('stale cancellation cannot overwrite concurrent approval',async()=>{
 const {DB,env}=fixture('SUBMITTED');const session=await createEmployeeSession(DB,'E',env);
 const prepare=DB.prepare.bind(DB);let injected=false;
 DB.prepare=sql=>{if(!injected&&sql.includes("SET status='CANCELLED'")){injected=true;DB.sqlite.exec("UPDATE ewa_requests SET status='APPROVED',client_approval_status='APPROVED',client_approved_by='client',approved_by='processor' WHERE id='R'");}return prepare(sql);};
 const response=await employeeEwa({env,request:req('/api/employee/ewa',{Authorization:`Bearer ${session.token}`},{action:'CANCEL'})});
 assert.equal(response.status,409,await response.clone().text());
 const row=DB.sqlite.prepare("SELECT status,approved_by FROM ewa_requests WHERE id='R'").get();
 assert.equal(row.status,'APPROVED');assert.equal(row.approved_by,'processor');
});

test('client approval rolls back when audit insertion fails',async()=>{
 const {DB,env}=fixture('SUBMITTED');const session=await createSession(DB,'CLIENT',env);
 DB.sqlite.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'Synthetic audit unavailable'); END;`);
 const response=await approval({env,request:req('/api/ewa',{Cookie:`proqpay_session=${session.token}`},{action:'APPROVE',id:'R'})});
 assert.equal(response.status,500);
 assert.equal(DB.sqlite.prepare("SELECT client_approval_status FROM ewa_requests WHERE id='R'").get().client_approval_status,'PENDING');
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs").get().n,0);
});

test('limit revoke refuses a canonical DR reservation',async()=>{
 const f=masterFixture();const headers=await roleSession(f,'PAYROLL_CONTROLLER');
 f.database.sqlite.exec(`
 INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email) VALUES('LIMIT','ORG-FIX','MASTER-FIX','C-FIX','UAT',1000000,1000000,'ACTIVE','processor@test');
 INSERT INTO e2pay_disbursement_request_limit_usage(id,org_id,limit_request_id,provider_account_registry_id,disbursement_request_id,reserved_amount,status) VALUES('RESERVE','ORG-FIX','LIMIT','MASTER-FIX','DR-FIX',1000,'RESERVED');`);
 const response=await limitApi({env:f.env,request:req('/api/e2pay-disbursement-limits',headers,{action:'REVOKE_LIMIT',id:'LIMIT',reason:'Synthetic audit revocation'})});
 assert.equal(response.status,409,await response.clone().text());
 assert.equal(f.database.sqlite.prepare("SELECT status FROM e2pay_disbursement_limit_requests WHERE id='LIMIT'").get().status,'ACTIVE');
 assert.equal(f.database.sqlite.prepare("SELECT status FROM e2pay_disbursement_request_limit_usage WHERE id='RESERVE'").get().status,'RESERVED');
});

test('allocated payroll lines cannot be excluded, edited, deleted, or falsely marked paid',async()=>{
 const {DB}=fixture();await applyEwaRepayments(DB,'S1');
 for (const sql of ["UPDATE payroll_run_lines SET included=0 WHERE id='L1'", "UPDATE payroll_run_lines SET net_amount=900000 WHERE id='L1'", "DELETE FROM payroll_run_lines WHERE id='L1'", "UPDATE ewa_requests SET status='REPAID' WHERE id='R'"]){
   assert.throws(()=>DB.sqlite.exec(sql),/EWA_(ALLOCATED_PAYROLL_LINE_LOCKED|COLLECTION_EVIDENCE_REQUIRED)/);
 }
 await markEwaRepaid(DB,'S1');
 assert.equal(DB.sqlite.prepare("SELECT status FROM ewa_requests WHERE id='R'").get().status,'REPAYING');
});

test('DR configuration error returns structured 503 without creating a DR',async()=>{
 const f=masterFixture();const headers=await roleSession(f,'PAYROLL_PROCESSOR');
 await activateGatewaySecureSettings(f.database,f.env,'ORG-FIX','admin@test',{provider:'E2PAY',environment:'UAT',credentials:{clientId:'synthetic',clientSecret:'synthetic'}});
 f.database.sqlite.exec(`INSERT INTO ewa_requests(id,org_id,client_id,employee_id,period,amount,fee,repayment,status,plafond_snapshot,days_worked_snapshot,tenure_months_snapshot,client_approval_status,client_approved_by,approved_by) VALUES('R-DR','ORG-FIX','C-FIX','E-FIX','2026-11',200000,50000,250000,'APPROVED',300000,15,12,'APPROVED','client','processor');`);
 const response=await drApi({env:{...f.env,PI_ENCRYPTION_KEY:'different-synthetic-key-at-least-32-long'},request:req('/api/disbursement-requests',headers,{action:'CREATE',sourceDocumentType:'EWA_REQUEST',sourceDocumentId:'R-DR',destinationMode:'DIRECT_EMPLOYEE'})});
 assert.equal(response.status,503);
 const payload=await response.json();assert.equal(payload.code,'E2PAY_CREDENTIALS_UNREADABLE');assert.ok(payload.correlationId);
 assert.ok(!JSON.stringify(payload).includes('synthetic-key'));

 assert.equal(f.database.sqlite.prepare("SELECT COUNT(*) n FROM disbursement_requests WHERE source_document_type='EWA_REQUEST'").get().n,0);
});


function paidInstruction(DB,{employee='E',amount=750000,total=amount,status='COMPLETED',reconciliation='MATCHED',proof=total}={}){
 DB.sqlite.prepare(`INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,content_hash,recipient_count)
   VALUES('PI','O','C','S1',?,?,'seed','test-pi-unique','synthetic-content-hash',1)`).run(status,total);
 DB.sqlite.prepare(`INSERT INTO payment_instruction_lines(id,payment_instruction_id,employee_id,beneficiary_name,bank_name,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
   VALUES('PIL','PI',?,'Synthetic','BCA','****7890','synthetic','synthetic','7890','synthetic-line-hash',?)`).run(employee,amount);
 DB.sqlite.prepare(`INSERT INTO reconciliations(id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status)
   VALUES('REC','PI',?,?,?,?,?)`).run(total,total,proof,total-proof,reconciliation);
}

test('exact allocated principal/fee and paid PI evidence close once with one collection audit',async()=>{
 const {DB}=fixture();await applyEwaRepayments(DB,'S1');
 paidInstruction(DB);
 const first=await markEwaRepaid(DB,'S1');assert.equal(first.collected,1);
 const second=await markEwaRepaid(DB,'S1');assert.equal(second.collected,0);
 assert.equal(DB.sqlite.prepare("SELECT status FROM ewa_requests WHERE id='R'").get().status,'REPAID');
 const a=DB.sqlite.prepare("SELECT * FROM ewa_repayment_allocations WHERE ewa_request_id='R'").get();
 assert.equal(a.payment_instruction_id,'PI');assert.ok(a.collected_at);assert.equal(a.total,250000);
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id='R' AND action='EWA_REPAID_RECONCILED'").get().n,1);
});

for(const [name,options] of Object.entries({wrongAmount:{amount:800000},wrongTotal:{total:900000},unpaid:{status:'APPROVED_FOR_PAYMENT'},unmatched:{reconciliation:'MISMATCH'},underpaid:{proof:700000}})){
 test(`collection fails closed for ${name}`,async()=>{
   const {DB}=fixture();await applyEwaRepayments(DB,'S1');paidInstruction(DB,options);
   assert.equal((await markEwaRepaid(DB,'S1')).collected,0);
   assert.equal(DB.sqlite.prepare("SELECT status FROM ewa_requests WHERE id='R'").get().status,'REPAYING');
 });
}

test('MATCHED instruction for another employee cannot close debtor loan',async()=>{
 const {DB}=fixture();await applyEwaRepayments(DB,'S1');
 DB.sqlite.exec("INSERT INTO employees(id,org_id,client_id,name,status_aktif) VALUES('OTHER','O','C','Other','ACTIVE')");
 paidInstruction(DB,{employee:'OTHER'});assert.equal((await markEwaRepaid(DB,'S1')).collected,0);
});

test('stale payroll line cannot overwrite a concurrent correction during allocation',async()=>{
 const {DB}=fixture();const batch=DB.batch.bind(DB);
 DB.batch=async ops=>{DB.sqlite.exec("UPDATE payroll_run_lines SET deduction_amount=100000,net_amount=900000 WHERE id='L1'");return batch(ops);};
 await assert.rejects(applyEwaRepayments(DB,'S1'),/EWA_ALLOCATION_CONFLICT/);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM ewa_repayment_allocations').get().n,0);
 assert.equal(DB.sqlite.prepare("SELECT net_amount FROM payroll_run_lines WHERE id='L1'").get().net_amount,900000);
 assert.equal(DB.sqlite.prepare("SELECT status FROM ewa_requests WHERE id='R'").get().status,'DISBURSED');
});

test('allocation and payroll deduction roll back if allocation audit fails',async()=>{
 const {DB}=fixture();DB.sqlite.exec(`CREATE TRIGGER fail_allocation_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END;`);
 await assert.rejects(applyEwaRepayments(DB,'S1'),/Synthetic audit failure/);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM ewa_repayment_allocations').get().n,0);
 assert.equal(DB.sqlite.prepare("SELECT net_amount FROM payroll_run_lines WHERE id='L1'").get().net_amount,1000000);
 assert.equal(DB.sqlite.prepare("SELECT status FROM ewa_requests WHERE id='R'").get().status,'DISBURSED');
});

test('collection and loan status roll back if collection audit fails',async()=>{
 const {DB}=fixture();await applyEwaRepayments(DB,'S1');paidInstruction(DB);
 DB.sqlite.exec(`CREATE TRIGGER fail_collection_audit BEFORE INSERT ON audit_logs WHEN NEW.action='EWA_REPAID_RECONCILED' BEGIN SELECT RAISE(ABORT,'Synthetic collection audit failure'); END;`);
 await assert.rejects(markEwaRepaid(DB,'S1'),/Synthetic collection audit failure/);
 assert.equal(DB.sqlite.prepare("SELECT collected_at FROM ewa_repayment_allocations WHERE ewa_request_id='R'").get().collected_at,null);
 assert.equal(DB.sqlite.prepare("SELECT status FROM ewa_requests WHERE id='R'").get().status,'REPAYING');
});

test('legacy EWA marker cannot silently stand in for a repayment allocation',async()=>{
 const {DB}=fixture('DISBURSED','{"ewaRepayment":-200000,"ewaFee":-50000}');
 await assert.rejects(applyEwaRepayments(DB,'S1'),/EWA_REPAYMENT_REVIEW_REQUIRED/);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM ewa_repayment_allocations').get().n,0);
});

test('Processor decision rolls back if the decision audit fails',async()=>{
 const {DB,env}=fixture('SUBMITTED');
 DB.sqlite.exec(`UPDATE ewa_requests SET client_approval_status='APPROVED',client_approved_by='client' WHERE id='R';
 INSERT INTO app_users(id,org_id,name,email,role,status,must_change_password,created_by,password_hash,password_salt,password_iterations)
 VALUES('PROCESSOR','O','Processor','processor@example.test','PAYROLL_PROCESSOR','ACTIVE',0,'seed','unused','unused',100000);
 CREATE TRIGGER fail_processor_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'Synthetic processor audit failure'); END;`);
 const session=await createSession(DB,'PROCESSOR',env);
 const response=await approval({env,request:req('/api/ewa',{Cookie:`proqpay_session=${session.token}`},{action:'APPROVE',id:'R'})});
 assert.equal(response.status,500);
 assert.equal(DB.sqlite.prepare("SELECT status FROM ewa_requests WHERE id='R'").get().status,'SUBMITTED');
});

test('employee cancellation is audited once and repeat cancel is rejected',async()=>{
 const {DB,env}=fixture('SUBMITTED');const session=await createEmployeeSession(DB,'E',env);
 const call=()=>employeeEwa({env,request:req('/api/employee/ewa',{Authorization:`Bearer ${session.token}`},{action:'CANCEL'})});
 assert.equal((await call()).status,200);assert.equal((await call()).status,409);
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id='R' AND action='EWA_CANCELLED'").get().n,1);
});

test('client losing an approval race returns conflict without a false audit',async()=>{
 const {DB,env}=fixture('SUBMITTED');const session=await createSession(DB,'CLIENT',env);
 const prepare=DB.prepare.bind(DB);let injected=false;
 DB.prepare=sql=>{if(!injected&&sql.includes('SET client_approval_status=')){injected=true;DB.sqlite.exec("UPDATE ewa_requests SET status='CANCELLED' WHERE id='R'");}return prepare(sql);};
 const response=await approval({env,request:req('/api/ewa',{Cookie:`proqpay_session=${session.token}`},{action:'APPROVE',id:'R'})});
 assert.equal(response.status,409);
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='EWA_CLIENT_APPROVED'").get().n,0);
});

test('DR rejection losing a decision race returns conflict without a false audit',async()=>{
 const f=masterFixture();const headers=await roleSession(f,'PAYROLL_CONTROLLER');
 f.database.sqlite.exec("UPDATE disbursement_requests SET status='PENDING_APPROVAL' WHERE id='DR-FIX'");
 const prepare=f.database.prepare.bind(f.database);let injected=false;
 f.database.prepare=sql=>{if(!injected&&sql.includes("SET status='REJECTED'")){injected=true;f.database.sqlite.exec("UPDATE disbursement_requests SET status='APPROVED' WHERE id='DR-FIX'");}return prepare(sql);};
 const response=await drApi({env:f.env,request:req('/api/disbursement-requests',headers,{action:'REJECT_REQUEST',id:'DR-FIX',reason:'Synthetic rejection reason'})});
 assert.equal(response.status,409);
 assert.equal(f.database.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='DISBURSEMENT_REQUEST_REJECTED'").get().n,0);
});

test('limit revoke rechecks reservations created after its initial read',async()=>{
 const f=masterFixture();const headers=await roleSession(f,'PAYROLL_CONTROLLER');
 f.database.sqlite.exec(`INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email) VALUES('LIMIT','ORG-FIX','MASTER-FIX','C-FIX','UAT',1000000,1000000,'ACTIVE','processor@test')`);
 const prepare=f.database.prepare.bind(f.database);let injected=false;
 f.database.prepare=sql=>{if(!injected&&sql.includes("SET status='REVOKED'")){injected=true;f.database.sqlite.exec(`INSERT INTO e2pay_disbursement_request_limit_usage(id,org_id,limit_request_id,provider_account_registry_id,disbursement_request_id,reserved_amount,status) VALUES('RESERVE','ORG-FIX','LIMIT','MASTER-FIX','DR-FIX',1000,'RESERVED')`);}return prepare(sql);};
 const response=await limitApi({env:f.env,request:req('/api/e2pay-disbursement-limits',headers,{action:'REVOKE_LIMIT',id:'LIMIT',reason:'Synthetic audit revocation'})});
 assert.equal(response.status,409);
 assert.equal(f.database.sqlite.prepare("SELECT status FROM e2pay_disbursement_limit_requests WHERE id='LIMIT'").get().status,'ACTIVE');
 assert.equal(f.database.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='E2PAY_DISBURSEMENT_LIMIT_REVOKED'").get().n,0);
 assert.throws(()=>f.database.sqlite.exec("UPDATE e2pay_disbursement_limit_requests SET status='REVOKED' WHERE id='LIMIT'"),/E2PAY_LIMIT_HAS_ACTIVE_RESERVATION/);
});

test('read-only limit status remains available without decrypting provider credentials',async()=>{
 const f=masterFixture();const headers=await roleSession(f,'PAYROLL_PROCESSOR');
 await activateGatewaySecureSettings(f.database,f.env,'ORG-FIX','admin@test',{provider:'E2PAY',environment:'UAT',credentials:{clientId:'synthetic',clientSecret:'synthetic'}});
 const response=await limitApi({env:{...f.env,PI_ENCRYPTION_KEY:'different-synthetic-key-at-least-32-long'},request:new Request('https://proqpay.test/api/e2pay-disbursement-limits',{headers})});
 assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.ok,true);assert.ok(payload.correlationId);
});

test('allocated pay run identity and loan amounts cannot be changed',async()=>{
 const {DB}=fixture();await applyEwaRepayments(DB,'S1');
 assert.throws(()=>DB.sqlite.exec("UPDATE payroll_submissions SET period='2026-12' WHERE id='S1'"),/EWA_ALLOCATED_PAYROLL_LINE_LOCKED/);
 assert.throws(()=>DB.sqlite.exec("DELETE FROM payroll_submissions WHERE id='S1'"),/EWA_ALLOCATED_PAYROLL_LINE_LOCKED/);
 assert.throws(()=>DB.sqlite.exec("UPDATE ewa_requests SET amount=100000 WHERE id='R'"),/EWA_ALLOCATION_IMMUTABLE/);
});
