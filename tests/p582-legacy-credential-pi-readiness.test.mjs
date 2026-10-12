import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {D1Mock} from './helpers/d1-mock.mjs';
import {createSession} from '../functions/api/_account-auth.js';
import {onRequest as readiness} from '../functions/api/legacy-pi-readiness.js';
import {onRequest as disbursementApi} from '../functions/api/disbursement-requests.js';
const source=async p=>readFile(new URL('../'+p,import.meta.url),'utf8');
function fixture({invalidSnapshot=false}={}){
 const DB=new D1Mock();DB.sqlite.exec(`
 INSERT INTO organizations(id,name,code) VALUES('ORG-P582','P582','P582'),('ORG-OTHER582','Other','OTHER582');
 INSERT INTO clients(id,org_id,code,name,status) VALUES('C-P582','ORG-P582','C1','Client Test','ACTIVE');
 INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
 VALUES('U-P582','ORG-P582','Maker','maker@p582.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
 ('X-P582','ORG-P582','Client','client@p582.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
 INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('SP-P582','C-P582','STANDARD','ACTIVE','2026-01-01','seed');
 INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by)
 VALUES('SUB-P582','ORG-P582','C-P582','SP-P582','STANDARD','2026-09','PAYMENT_APPROVAL_PENDING','seed');
 INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,provisioning_state,created_by)
 VALUES('PPA-P582','ORG-P582','C-P582','E2PAY','UAT','SUB_ACCOUNT','SUBACCOUNT-0190','ACTIVE','PROVISIONED','seed');
 INSERT INTO provider_provisioning_sessions(id,org_id,client_id,provider,environment,provider_account_registry_id,state,credential_mode,credential_state,credential_version,created_by)
 VALUES('PPS-P582','ORG-P582','C-P582','E2PAY','UAT','PPA-P582','MANUAL_REVIEW','SERVICE_MANAGED','LEGACY_MANUAL',0,'seed');
 INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count,content_hash,provider,provider_environment,provider_account_registry_id,provider_sub_account_id)
 VALUES('PI-P582','ORG-P582','C-P582','SUB-P582','PAYMENT_APPROVAL_PENDING',15900000,'U-P582','PI-IDEM-P582',1,'HASH-P582','E2PAY','UAT','PPA-P582','SUBACCOUNT-0190');
 INSERT INTO payment_instruction_lines(id,payment_instruction_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
 VALUES('PIL-P582','PI-P582','Employee Example','BANK','002','••••1234','encrypted-only','iv-only','1234','LINEHASH',15900000);
 `.replace("'PAYMENT_APPROVAL_PENDING',15900000,'U-P582'",invalidSnapshot?"'PAYMENT_APPROVAL_PENDING',16000000,'U-P582'":"'PAYMENT_APPROVAL_PENDING',15900000,'U-P582'").replace("'PPA-P582','SUBACCOUNT-0190');",invalidSnapshot?"'PPA-P582','WRONG');":"'PPA-P582','SUBACCOUNT-0190');"));
 const env={DB,DEFAULT_ORG_ID:'ORG-P582',AUTH_MODE:'session',SESSION_SECRET:'p582-session-secret-at-least-32-characters'};
 return {DB,env};
}
async function call(env,token,route='/api/legacy-pi-readiness',method='GET'){
 const response=await readiness({request:new Request('https://proqpay.test'+route,{method,headers:{Cookie:`proqpay_session=${token}`}}),env});
 return {status:response.status,data:await response.json()};
}
test('P5.8.2 legacy credential recovery is required, without account recreate or DR writes',async()=>{
 const {DB,env}=fixture();const session=await createSession(DB,'U-P582',env);
 const result=await call(env,session.token);
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.mode,'READ_ONLY_PRECHECK');
 assert.equal(result.data.providerExecutionAttempted,false);
 const pi=result.data.records[0];
 assert.equal(pi.amount,15900000);assert.equal(pi.snapshotValid,true);assert.equal(pi.providerBound,true);
 assert.equal(pi.credentialRecoveryRequired,true);assert.equal(pi.credentialReady,false);
 assert.equal(pi.canCreateCanonicalDr,false);assert.equal(pi.executionAuthorized,false);
 assert.equal(pi.nextAction,'RECOVER_EXISTING_CREDENTIAL');
 assert.equal(pi.existingGatewayCount,0);assert.equal(pi.existingDrCount,0);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM disbursement_requests').get().n,0);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_provider_accounts').get().n,1);
});
test('P5.8.2 recovered credential allows only preliminary DR create, not approval or execution',async()=>{
 const {DB,env}=fixture();const session=await createSession(DB,'U-P582',env);
 DB.sqlite.exec(`UPDATE payment_provider_accounts SET metadata_json='{"merchantCredential":{"ciphertext":"encrypted-placeholder","iv":"iv-placeholder","version":1}}' WHERE id='PPA-P582';
 UPDATE provider_provisioning_sessions SET credential_state='HEALTHY',credential_version=1,state='READY' WHERE id='PPS-P582';`);
 const result=await call(env,session.token);
 assert.equal(result.status,200,JSON.stringify(result.data));const pi=result.data.records[0];
 assert.equal(pi.credentialReady,true);assert.equal(pi.canCreateCanonicalDr,true);
 assert.equal(pi.channel.ready,false);assert.equal(pi.liquidity.ready,false);
 assert.equal(pi.readyForControllerApproval,false);assert.equal(pi.executionAuthorized,false);
 assert.equal(pi.nextAction,'CONFIRM_PROVIDER_CHANNEL');
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM disbursement_requests').get().n,0);
});
test('P5.8.2 gateway presence blocks canonical creation and routes to legacy reconciliation, even with recovered credential',async()=>{
 const {DB,env}=fixture();const session=await createSession(DB,'U-P582',env);
 DB.sqlite.exec(`INSERT INTO payment_gateway_transactions(id,org_id,client_id,payment_instruction_id,provider,status,amount,idempotency_key,request_hash,created_by)
 VALUES('GT-P582','ORG-P582','C-P582','PI-P582','E2PAY','PROCESSING',15900000,'IDEM-GT-P582','HASH-GT-P582','seed');`);
 const result=await call(env,session.token);const pi=result.data.records[0];
 assert.equal(pi.canCreateCanonicalDr,false);assert.equal(pi.nextAction,'RECONCILE_LEGACY_NO_REPLAY');
 assert.equal(pi.existingGatewayCount,1);
});
test('P5.8.2 invalid snapshot and provider account mismatches are always blocked',async()=>{
 const {DB,env}=fixture({invalidSnapshot:true});const session=await createSession(DB,'U-P582',env);
 const result=await call(env,session.token);const pi=result.data.records[0];
 assert.equal(pi.snapshotValid,false);assert.equal(pi.providerBound,false);assert.equal(pi.canCreateCanonicalDr,false);
 assert.ok(pi.blockingCodes.includes('PI_IMMUTABLE_SNAPSHOT_INVALID'));
 assert.ok(pi.blockingCodes.includes('PI_PROVIDER_SNAPSHOT_NOT_BOUND'));
});
test('P5.8.2 corporate beneficiary cannot override an invalid immutable PI snapshot',async()=>{
 const {DB,env}=fixture({invalidSnapshot:true});
 // Align the provider account to the PI in the fixture, without altering PI's immutable snapshot.
 DB.sqlite.exec(`UPDATE payment_provider_accounts SET provider_sub_account_id='WRONG',
 metadata_json='{"merchantCredential":{"ciphertext":"encrypted-placeholder","iv":"iv-placeholder","version":1}}'
 WHERE id='PPA-P582';
 UPDATE provider_provisioning_sessions SET credential_state='HEALTHY',credential_version=1,state='READY' WHERE id='PPS-P582';
 INSERT INTO client_bank_account_change_requests(id,org_id,client_id,action,reason,status,requested_by_email)
 VALUES('CR-P582','ORG-P582','C-P582','CREATE_PRIMARY','UAT governed primary','APPROVED','maker@p582.test');
 INSERT INTO client_bank_accounts(id,org_id,client_id,bank_code,bank_name,account_name,
 account_number_ciphertext,account_number_iv,account_number_hash,account_number_last4,
 purpose,status,is_primary,verified_by_email,verified_at,created_by_email,source_change_request_id,
 last_change_request_id,verification_version)
 VALUES('BA-P582','ORG-P582','C-P582','BCA','BCA','PT Client Test',
 'encrypted-placeholder','iv-placeholder','hash-placeholder','1234',
 'PAYROLL_SETTLEMENT','VERIFIED',1,'controller@p582.test','2026-10-12','maker@p582.test',
 'CR-P582','CR-P582',1);`);
 const session=await createSession(DB,'U-P582',env);
 const response=await call(env,session.token,'/api/legacy-pi-readiness?id=PI-P582&destinationMode=CLIENT_ACCOUNT');
 assert.equal(response.status,200,JSON.stringify(response.data));
 const record=response.data.records[0];
 assert.equal(record.providerBound,true);
 assert.equal(record.credentialReady,true);
 assert.equal(record.snapshotValid,false);
 assert.equal(record.beneficiaryReady,false,'Governed corporate bank does not repair an invalid source PI');
 assert.equal(record.canCreateCanonicalDr,false);
 assert.ok(record.blockingCodes.includes('PI_IMMUTABLE_SNAPSHOT_INVALID'));
 assert.equal(record.executionAuthorized,false);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM disbursement_requests').get().n,0);
});

test('P5.8.2 canonical DR backend rejects invalid PI snapshot for corporate strategy as well',async()=>{
 const {DB,env}=fixture({invalidSnapshot:true});
 // The actual financial endpoint must enforce the same source invariant as the read-only precheck.
 DB.sqlite.exec(`UPDATE payment_provider_accounts SET provider_sub_account_id='WRONG',
 metadata_json='{"merchantCredential":{"ciphertext":"encrypted-placeholder","iv":"iv-placeholder","version":1}}'
 WHERE id='PPA-P582';`);
 const session=await createSession(DB,'U-P582',env);
 const request=new Request('https://proqpay.test/api/disbursement-requests',{method:'POST',
  headers:{Cookie:`proqpay_session=${session.token}`,Origin:'https://proqpay.test','Content-Type':'application/json'},
  body:JSON.stringify({action:'CREATE',sourceDocumentType:'PAYMENT_INSTRUCTION',sourceDocumentId:'PI-P582',destinationMode:'CLIENT_ACCOUNT'})});
 const response=await disbursementApi({request,env});
 const data=await response.json();
 assert.equal(response.status,409,JSON.stringify(data));
 assert.equal(data.code,'DISBURSEMENT_PI_TOTAL_MISMATCH');
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM disbursement_requests').get().n,0);
});

test('P5.8.2 read-only endpoint enforces roles and rejects POST',async()=>{
 const {DB,env}=fixture();const client=await createSession(DB,'X-P582',env);
 assert.equal((await call(env,client.token)).status,403);
 const maker=await createSession(DB,'U-P582',env);
 assert.equal((await call(env,maker.token,'/api/legacy-pi-readiness','POST')).status,405);
 assert.equal((await call(env,maker.token,'/api/legacy-pi-readiness?destinationMode=UNKNOWN')).status,422);
 assert.equal((await call(env,maker.token,'/api/legacy-pi-readiness?id=ANOTHER_PI')).data.totalReturned,0);
});
test('P5.8.2 UI offers scoped recovery link without automatic transfer actions',async()=>{
 const [ui,dr,api]=await Promise.all([source('src/components/LegacyPIReadinessPanel.tsx'),source('src/components/CanonicalDisbursementWorkspace.tsx'),source('functions/api/legacy-pi-readiness.js')]);
 assert.match(ui,/recoveryAccountId=\$\{encodeURIComponent\(row.providerAccountRegistryId\)\}/);
 assert.match(ui,/Periksa ulang kesiapan/);
 assert.match(dr,/LegacyPIReadinessPanel/);
 assert.match(api,/providerExecutionAttempted:false/);
 assert.doesNotMatch(api,/INSERT INTO disbursement_requests|UPDATE payment_provider_accounts|action:'EXECUTE'/);
});
