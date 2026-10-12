import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {D1Mock} from './helpers/d1-mock.mjs';
import {createSession} from '../functions/api/_account-auth.js';
import {onRequest as archivesApi} from '../functions/api/uat-administrative-archives.js';
import {onRequest as readinessApi} from '../functions/api/legacy-pi-readiness.js';
import {onRequest as drApi} from '../functions/api/disbursement-requests.js';

const migration=readFileSync(new URL('../migrations/0070_p584_uat_administrative_closure.sql',import.meta.url),'utf8');
function fixture(){
 const db=new D1Mock();
 db.sqlite.exec(`
 INSERT INTO organizations(id,name,code) VALUES('ORG-P584','Test','P584');
 INSERT INTO clients(id,org_id,code,name,status) VALUES('C-P584','ORG-P584','P584','UAT Client','ACTIVE');
 INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
 VALUES('U-P584','ORG-P584','Processor','processor@p584.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
 ('X-P584','ORG-P584','Client','client@p584.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
 INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('SP-P584','C-P584','STANDARD','ACTIVE','2026-01-01','seed');
 INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by)
 VALUES('SUB-P584','ORG-P584','C-P584','SP-P584','STANDARD','2026-10','PAYMENT_APPROVAL_PENDING','seed'),
 ('SUB-PROD-P584','ORG-P584','C-P584','SP-P584','STANDARD','2026-09','PAYMENT_APPROVAL_PENDING','seed');
 INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,provisioning_state,created_by)
 VALUES('ACC-UAT-P584','ORG-P584','C-P584','E2PAY','UAT','SUB_ACCOUNT','SUB-UAT-584','ACTIVE','PROVISIONED','seed'),
 ('ACC-PROD-P584','ORG-P584','C-P584','E2PAY','PRODUCTION','SUB_ACCOUNT','SUB-PROD-584','ACTIVE','PROVISIONED','seed');
 INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count,content_hash,provider,provider_environment,provider_account_registry_id,provider_sub_account_id)
 VALUES('PI-UAT-P584','ORG-P584','C-P584','SUB-P584','PAYMENT_APPROVAL_PENDING',15900000,'U-P584','IDEM-UAT-P584',1,'HASH-UAT-584','E2PAY','UAT','ACC-UAT-P584','SUB-UAT-584'),
 ('PI-PROD-P584','ORG-P584','C-P584','SUB-PROD-P584','PAYMENT_APPROVAL_PENDING',900,'U-P584','IDEM-PROD-P584',1,'HASH-PROD-584','E2PAY','PRODUCTION','ACC-PROD-P584','SUB-PROD-584');
 INSERT INTO legacy_data_cutover_records(id,org_id,client_id,source_type,source_id,source_account_id,environment,legacy_status,amount_idr)
 VALUES('LDC-PI-UAT-P584','ORG-P584','C-P584','UAT_PAYMENT_INSTRUCTION','PI-UAT-P584','ACC-UAT-P584','UAT','PAYMENT_APPROVAL_PENDING',15900000);
 `);
 const env={DB:db,DEFAULT_ORG_ID:'ORG-P584',AUTH_MODE:'session',SESSION_SECRET:'p584-session-secret-long-enough-123456789'};
 return {db,env};
}
async function fetchArchive(env,token,method='GET'){
 const res=await archivesApi({request:new Request('https://proqpay.test/api/uat-administrative-archives',{method,headers:{Cookie:`proqpay_session=${token}`}}),env});
 return{status:res.status,body:await res.json()};
}

test('P5.8.4 archives only unexecuted UAT PI as assumed-complete, not as E2Pay settled',()=>{
 const{db}=fixture();
 const before=db.sqlite.prepare('SELECT id,status,expected_total FROM payment_instructions ORDER BY id').all();
 db.sqlite.exec(migration);
 const c=db.sqlite.prepare('SELECT * FROM uat_administrative_closures').all();
 assert.equal(c.length,1);assert.equal(c[0].source_document_id,'PI-UAT-P584');
 assert.equal(c[0].closure_reason,'UAT_ASSUMED_COMPLETE_NO_SETTLEMENT_EVIDENCE');
 assert.equal(c[0].provider_settlement_verified,0);
 assert.equal(c[0].financial_execution_allowed,0);
 assert.equal(c[0].amount_idr,15900000);
 assert.deepEqual(db.sqlite.prepare('SELECT id,status,expected_total FROM payment_instructions ORDER BY id').all(),before);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM disbursement_requests').get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM payment_gateway_transactions').get().n,0);
 db.sqlite.exec(migration);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM uat_administrative_closures').get().n,1);
 assert.throws(()=>db.sqlite.exec("DELETE FROM uat_administrative_closures WHERE source_document_id='PI-UAT-P584'"),/UAT_ADMINISTRATIVE_CLOSURE_IMMUTABLE/);
});

test('P5.8.4 DB rejects canonical and legacy gateway attempts for archived UAT PI',()=>{
 const{db}=fixture();db.sqlite.exec(migration);
 const insertGateway=`INSERT INTO payment_gateway_transactions(id,org_id,client_id,payment_instruction_id,provider,status,amount,idempotency_key,request_hash,created_by)
 VALUES('GT-ARCHIVED-P584','ORG-P584','C-P584','PI-UAT-P584','E2PAY','CREATED',15900000,'IDEM-GT-P584','HASH-P584','seed')`;
 assert.throws(()=>db.sqlite.exec(insertGateway),/UAT_ARCHIVED_SOURCE_NOT_EXECUTABLE/);
 const insertDR=`INSERT INTO disbursement_requests(id,org_id,client_id,provider,purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,amount,recipient_count,status,created_by_email,client_reference,correlation_id,idempotency_key,routing_hash)
 VALUES('DR-ARCHIVED-P584','ORG-P584','C-P584','E2PAY','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE','PAYMENT_INSTRUCTION','PI-UAT-P584',15900000,1,'DRAFT','processor@p584.test','REF-P584','CORR-P584','IDEM-P584','HASH-P584')`;
 assert.throws(()=>db.sqlite.exec(insertDR),/UAT_ARCHIVED_SOURCE_NOT_EXECUTABLE/);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM disbursement_requests').get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM payment_gateway_transactions').get().n,0);
});

test('P5.8.4 administrative archive API requires privileged session and remains read-only',async()=>{
 const{db,env}=fixture();db.sqlite.exec(migration);
 const processor=await createSession(db,'U-P584',env);
 const r=await fetchArchive(env,processor.token);
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.mode,'UAT_ADMINISTRATIVE_ARCHIVE_NOT_PROVIDER_SETTLED');
 assert.equal(r.body.records.length,1);
 assert.equal(r.body.records[0].assumedCompleteForUat,true);
 assert.equal(r.body.records[0].providerSettlementVerified,false);
 assert.equal(r.body.records[0].canExecute,false);
 assert.equal((await fetchArchive(env,processor.token,'POST')).status,405);
 const client=await createSession(db,'X-P584',env);
 assert.equal((await fetchArchive(env,client.token)).status,403);
});

test('P5.8.4 readiness and DR creation API reject administratively archived UAT source explicitly',async()=>{
 const{db,env}=fixture();db.sqlite.exec(migration);
 const processor=await createSession(db,'U-P584',env);
 const headers={Cookie:`proqpay_session=${processor.token}`};
 const readyResp=await readinessApi({request:new Request('https://proqpay.test/api/legacy-pi-readiness?id=PI-UAT-P584',{headers}),env});
 assert.equal(readyResp.status,200);const ready=(await readyResp.json()).records[0];
 assert.equal(ready.administrativelyArchivedForUat,true);
 assert.equal(ready.canCreateCanonicalDr,false);
 assert.equal(ready.nextAction,'VIEW_UAT_ADMINISTRATIVE_ARCHIVE');
 const created=await drApi({request:new Request('https://proqpay.test/api/disbursement-requests',{
  method:'POST',headers:{...headers,Origin:'https://proqpay.test','Content-Type':'application/json'},
  body:JSON.stringify({action:'CREATE',sourceDocumentType:'PAYMENT_INSTRUCTION',sourceDocumentId:'PI-UAT-P584',destinationMode:'DIRECT_EMPLOYEE'})}),env});
 assert.equal(created.status,409);assert.equal((await created.json()).code,'UAT_ARCHIVED_SOURCE_NOT_EXECUTABLE');
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM disbursement_requests').get().n,0);
});

test('P5.8.4 financial workspace no longer renders legacy diagnostic panels or prominent funding card',()=>{
 const disbursement=readFileSync(new URL('../src/components/CanonicalDisbursementWorkspace.tsx',import.meta.url),'utf8');
 const payments=readFileSync(new URL('../src/components/OperatingWorkspace.tsx',import.meta.url),'utf8');
 const settings=readFileSync(new URL('../src/components/PaymentGatewaySettings.tsx',import.meta.url),'utf8');
 const register=readFileSync(new URL('../src/components/CanonicalTransactionRegister.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(disbursement,/LegacyPIReadinessPanel|LegacyDataCutoverPanel/);
 assert.doesNotMatch(payments,/FundingReadinessSummary role=/);
 assert.match(payments,/uatClosedPiIds.has\(row.id\)/);
 assert.match(payments,/uatArchiveVerified/);
 assert.match(payments,/Antrean pembayaran ditutup sementara/);
 assert.match(settings,/Arsip UAT & diagnostik legacy/);
 assert.match(register,/Histori gateway lama \(arsip read-only\)/);
});
