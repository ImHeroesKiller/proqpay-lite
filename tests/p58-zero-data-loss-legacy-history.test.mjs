import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {D1Mock} from './helpers/d1-mock.mjs';
import {createSession} from '../functions/api/_account-auth.js';
import {onRequest as historyApi} from '../functions/api/legacy-transaction-history.js';
import {onRequest as compatibilityApi} from '../functions/api/legacy-compatibility.js';
import {d1Batch} from '../functions/api/_d1.js';
const read=(p)=>readFile(new URL('../'+p,import.meta.url),'utf8');
function fixture(){
 const DB=new D1Mock();
 DB.sqlite.exec(`
 INSERT INTO organizations(id,name,code) VALUES('ORG-P58','Test','P58'),('ORG-OTHER','Other','OTH');
 INSERT INTO clients(id,org_id,code,name,status) VALUES('CLIENT-P58','ORG-P58','P58','Alpha','ACTIVE'),('CLIENT-OTHER','ORG-OTHER','OTH','Other','ACTIVE');
 INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
 VALUES('U-P58','ORG-P58','Admin','admin@p58.test','SUPER_ADMIN','ACTIVE','hash','salt',100000,0,0,'seed'),
 ('C-P58','ORG-P58','Client','client@p58.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
 INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('SP-P58','CLIENT-P58','STANDARD','ACTIVE','2026-01-01','seed'),('SP-OTHER','CLIENT-OTHER','STANDARD','ACTIVE','2026-01-01','seed');
 INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by)
 VALUES('PS-P58','ORG-P58','CLIENT-P58','SP-P58','STANDARD','2026-10','PAYMENT_APPROVAL_PENDING','seed'),('PS-OTHER','ORG-OTHER','CLIENT-OTHER','SP-OTHER','STANDARD','2026-10','PAYMENT_APPROVAL_PENDING','seed');
 INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count)
 VALUES('PI-P58','ORG-P58','CLIENT-P58','PS-P58','COMPLETED',100,'U-P58','PI-IDEM-P58',1),('PI-OTHER','ORG-OTHER','CLIENT-OTHER','PS-OTHER','COMPLETED',999,'U-P58','PI-IDEM-OTHER',1);
 INSERT INTO payment_gateway_transactions(id,org_id,client_id,payment_instruction_id,provider,status,amount,idempotency_key,request_hash,created_by,provider_reference,provider_transaction_id,provider_sub_account_last4)
 VALUES('GT-P58','ORG-P58','CLIENT-P58','PI-P58','E2PAY','SUCCEEDED',100,'GTID-P58','HASH-P58','admin','REF-E2PAY-XYZ','TXN-P58','0190'),
 ('GT-OTHER','ORG-OTHER','CLIENT-OTHER','PI-OTHER','E2PAY','SUCCEEDED',999,'GTID-OTHER','HASH-OTHER','admin','PRIVATE_OTHER','TXN-OTHER','0200');
 INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,provisioning_state,created_by)
 VALUES('PPA-P58','ORG-P58','CLIENT-P58','E2PAY','UAT','SUB_ACCOUNT','SUB-P58','ACTIVE','PROVISIONED','seed');
 INSERT INTO provider_provisioning_sessions(id,org_id,client_id,provider,environment,provider_account_registry_id,state,credential_mode,credential_state,credential_version,created_by)
 VALUES('PPS-P58','ORG-P58','CLIENT-P58','E2PAY','UAT','PPA-P58','MANUAL_REVIEW','SERVICE_MANAGED','LEGACY_MANUAL',0,'seed');
 `);
 const env={DB,DEFAULT_ORG_ID:'ORG-P58',AUTH_MODE:'session',SESSION_SECRET:'p58-test-session-secret-at-least-32-chars'};
 return{DB,env};
}
async function get(api,env,token,path,method='GET',body){
 const headers={Cookie:`proqpay_session=${token}`,...(body?{'Content-Type':'application/json',Origin:'https://proqpay.test'}:{})};
 const res=await api({request:new Request('https://proqpay.test'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env});
 return{status:res.status,data:await res.json()};
}

test('P5.8 historical gateway is read-only, per-tenant, non-executable, and masked',async()=>{
 const{DB,env}=fixture();const session=await createSession(DB,'U-P58',env);
 const response=await get(historyApi,env,session.token,'/api/legacy-transaction-history?period=2026-10&page=1&pageSize=40');
 assert.equal(response.status,200,JSON.stringify(response.data));
 assert.equal(response.data.pagination.total,1);
 const tx=response.data.transactions[0];
 assert.equal(tx.registerId,'LEGACY:GT-P58');
 assert.equal(tx.sourceStrategy,'LEGACY_GATEWAY_READ_ONLY');
 for(const key of ['canExecute','canRetry','canModify'])assert.equal(tx[key],false);
 assert.equal(tx.providerSubAccountIdMasked,'••••0190');
 assert.equal(tx.amount,100);
 assert.equal(JSON.stringify(response.data).includes('GT-OTHER'),false);
 assert.equal(JSON.stringify(response.data).includes('PRIVATE_OTHER'),false);
 assert.equal(JSON.stringify(response.data).includes('request_hash'),false);
 const details=await get(historyApi,env,session.token,'/api/legacy-transaction-history?id=GT-P58');
 assert.equal(details.status,200);
 assert.equal(details.data.transaction.status,'SUCCEEDED');
 const cross=await get(historyApi,env,session.token,'/api/legacy-transaction-history?id=GT-OTHER');
 assert.equal(cross.status,404);
 const blocked=await get(historyApi,env,session.token,'/api/legacy-transaction-history','POST',{action:'EXECUTE',id:'GT-P58'});
 assert.equal(blocked.status,405);
 assert.equal(blocked.data.code,'LEGACY_HISTORY_READ_ONLY');
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS c FROM disbursement_requests").get().c,0);
});

test('P5.8 client users cannot view internal legacy financial history',async()=>{
 const{DB,env}=fixture();const session=await createSession(DB,'C-P58',env);
 assert.equal((await get(historyApi,env,session.token,'/api/legacy-transaction-history')).status,403);
});

test('P5.8 compatibility refresh handles LEGACY_MANUAL → HEALTHY → LEGACY_MANUAL without primary-key collision',async()=>{
 const{DB,env}=fixture();const session=await createSession(DB,'U-P58',env);
 async function refresh(){return get(compatibilityApi,env,session.token,'/api/legacy-compatibility','POST',{action:'REFRESH_AUDIT'});}
 const initial=await refresh();assert.equal(initial.status,200,JSON.stringify(initial.data));
 const original=DB.sqlite.prepare("SELECT id,classification FROM legacy_compatibility_records WHERE resource_id='PPA-P58'").get();
 assert.equal(original.classification,'LEGACY_CREDENTIAL_RECOVERY_REQUIRED');
 DB.sqlite.exec("UPDATE provider_provisioning_sessions SET credential_state='HEALTHY',credential_version=1,state='READY' WHERE id='PPS-P58'");
 const recovered=await refresh();assert.equal(recovered.status,200,JSON.stringify(recovered.data));
 const ready=DB.sqlite.prepare("SELECT id,classification,compatibility_status FROM legacy_compatibility_records WHERE resource_id='PPA-P58'").get();
 assert.equal(ready.id,original.id);
 assert.equal(ready.classification,'LEGACY_PROVIDER_SESSION_BACKFILLED');
 assert.equal(ready.compatibility_status,'RESOLVED');
 DB.sqlite.exec("UPDATE provider_provisioning_sessions SET credential_state='LEGACY_MANUAL',credential_version=0,state='MANUAL_REVIEW' WHERE id='PPS-P58'");
 assert.equal((await refresh()).status,200);
 const reverted=DB.sqlite.prepare("SELECT id,classification,compatibility_status FROM legacy_compatibility_records WHERE resource_id='PPA-P58'").get();
 assert.equal(reverted.id,original.id);
 assert.equal(reverted.compatibility_status,'RECOVERY_REQUIRED');
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM legacy_compatibility_records WHERE resource_id='PPA-P58'").get().n,1);
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM payment_gateway_transactions WHERE id='GT-P58'").get().n,1);
});

test('P5.8 historical UI uses unified register with distinct read-only lane',async()=>{
 const [history,reg,api]=await Promise.all([read('src/components/LegacyTransactionHistory.tsx'),read('src/components/CanonicalTransactionRegister.tsx'),read('functions/api/legacy-transaction-history.js')]);
 assert.match(reg,/Histori gateway lama \(arsip read-only\)/);
 assert.match(reg,/LegacyTransactionHistory/);
 assert.match(history,/Read Only · No Retry/);
 assert.match(history,/canRetry/); // expect false via DTO, no retry action in UI
 assert.doesNotMatch(history,/action:'EXECUTE'|action:'RETRY_FAILED'/);
 assert.match(api,/LEGACY_HISTORY_READ_ONLY/);
 assert.match(api,/pgt.org_id=\?/);
 assert.doesNotMatch(api,/INSERT INTO disbursement_requests|UPDATE payment_gateway_transactions/);
});
