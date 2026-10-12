import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {D1Mock} from './helpers/d1-mock.mjs';
import {createSession} from '../functions/api/_account-auth.js';
import {archivedUatFundingAccountIds} from '../functions/api/_uat-operational-funding.js';
import {onRequest as fundingApi} from '../functions/api/e2pay-disbursement-limits.js';

function fixture(){
 const db=new D1Mock();
 db.sqlite.exec(`
 INSERT INTO organizations(id,name,code) VALUES('ORG-P585','P585','P585'),('ORG-OTHER','Other','OTHER');
 INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-P585','ORG-P585','P585','Fixture','ACTIVE'),
 ('CLI-LIVE','ORG-P585','LIVE','Live Client','ACTIVE'),
 ('CLI-LIMIT','ORG-P585','LIMIT','Limit Client','ACTIVE');
 INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
 VALUES('U-P585','ORG-P585','Processor','processor@p585.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
 ('X-P585','ORG-P585','Client','client@p585.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
 INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('SP-P585','CLI-P585','STANDARD','ACTIVE','2026-01-01','seed'),
 ('SP-LIVE','CLI-LIVE','STANDARD','ACTIVE','2026-01-01','seed');
 INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by)
 VALUES('SUB-ARCH','ORG-P585','CLI-P585','SP-P585','STANDARD','2026-09','PAYMENT_APPROVAL_PENDING','seed'),
 ('SUB-LIVE','ORG-P585','CLI-LIVE','SP-LIVE','STANDARD','2026-10','PAYMENT_APPROVAL_PENDING','seed');
 INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,provisioning_state,created_by)
 VALUES('PPA-ARCH','ORG-P585','CLI-P585','E2PAY','UAT','SUB_ACCOUNT','SUB-0190','ACTIVE','PROVISIONED','seed'),
 ('PPA-LIVE','ORG-P585','CLI-LIVE','E2PAY','UAT','SUB_ACCOUNT','SUB-1001','ACTIVE','PROVISIONED','seed'),
 ('PPA-LIMIT','ORG-P585','CLI-LIMIT','E2PAY','UAT','SUB_ACCOUNT','SUB-1002','ACTIVE','PROVISIONED','seed'),
 ('PPA-PROD','ORG-P585','CLI-P585','E2PAY','PRODUCTION','SUB_ACCOUNT','SUB-9901','ACTIVE','PROVISIONED','seed');
 INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count,content_hash,provider,provider_environment,provider_account_registry_id,provider_sub_account_id)
 VALUES('PI-ARCH','ORG-P585','CLI-P585','SUB-ARCH','PAYMENT_APPROVAL_PENDING',15900000,'U-P585','IDEM-ARCH',1,'HASH-ARCH','E2PAY','UAT','PPA-ARCH','SUB-0190'),
 ('PI-LIVE','ORG-P585','CLI-LIVE','SUB-LIVE','PAYMENT_APPROVAL_PENDING',2000000,'U-P585','IDEM-LIVE',1,'HASH-LIVE','E2PAY','UAT','PPA-LIVE','SUB-1001');
 INSERT INTO legacy_data_cutover_records(id,org_id,client_id,source_type,source_id,source_account_id,environment,legacy_status,amount_idr)
 VALUES('LDC-ARCH','ORG-P585','CLI-P585','UAT_PROVIDER_ACCOUNT','PPA-ARCH','PPA-ARCH','UAT','ACTIVE',0),
 ('LDC-LIVE','ORG-P585','CLI-LIVE','UAT_PROVIDER_ACCOUNT','PPA-LIVE','PPA-LIVE','UAT','ACTIVE',0),
 ('LDC-LIMIT','ORG-P585','CLI-LIMIT','UAT_PROVIDER_ACCOUNT','PPA-LIMIT','PPA-LIMIT','UAT','ACTIVE',0);
 INSERT INTO uat_administrative_closures(id,org_id,client_id,source_document_type,source_document_id,provider_account_registry_id,environment,closure_reason,amount_idr)
 VALUES('CLOSED-ARCH','ORG-P585','CLI-P585','PAYMENT_INSTRUCTION','PI-ARCH','PPA-ARCH','UAT','UAT_ASSUMED_COMPLETE_NO_SETTLEMENT_EVIDENCE',15900000);
 INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,reason,requested_by_email)
 VALUES('LIMIT-P585','ORG-P585','PPA-LIMIT','CLI-LIMIT','UAT',900000,900000,'ACTIVE','Open funding','processor@p585.test');
 `);
 const env={DB:db,DEFAULT_ORG_ID:'ORG-P585',AUTH_MODE:'session',SESSION_SECRET:'p585-test-secret-long-enough-123456789'};
 return {db,env};
}
async function query(env,token,path){
 const res=await fundingApi({request:new Request('https://proqpay.test'+path,{headers:{Cookie:`proqpay_session=${token}`}}),env});
 return{status:res.status,json:await res.json()};
}

test('P5.8.5 excludes only archived UAT funding without remaining activity',async()=>{
 const{db}=fixture();
 const excluded=await archivedUatFundingAccountIds(db,'ORG-P585');
 assert.deepEqual([...excluded],['PPA-ARCH']);
 assert(!excluded.has('PPA-LIVE'),'pending PI must remain operational');
 assert(!excluded.has('PPA-LIMIT'),'active limit must remain visible');
 assert(!excluded.has('PPA-PROD'),'production cannot be archived by UAT state');
});

test('P5.8.5 funding operational-only GET hides archived UAT, keeps live accounts and active limits',async()=>{
 const{db,env}=fixture();const sess=await createSession(db,'U-P585',env);
 const full=await query(env,sess.token,'/api/e2pay-disbursement-limits');
 assert.equal(full.status,200,JSON.stringify(full.json));
 assert.equal(full.json.funding.length,4);
 const active=await query(env,sess.token,'/api/e2pay-disbursement-limits?operationalOnly=1');
 assert.equal(active.status,200,JSON.stringify(active.json));
 assert.equal(active.json.archivedUatAccountCount,1);
 assert.deepEqual(new Set(active.json.funding.map(x=>x.providerAccountRegistryId)),new Set(['PPA-LIVE','PPA-LIMIT','PPA-PROD']));
 assert.equal(active.json.requests.length,1);
 assert.equal(active.json.requests[0].providerAccountRegistryId,'PPA-LIMIT');
 const filtered=await query(env,sess.token,'/api/e2pay-disbursement-limits?operationalOnly=1&providerAccountRegistryId=PPA-ARCH');
 assert.equal(filtered.status,200);assert.equal(filtered.json.funding.length,0);
 assert.equal(db.sqlite.prepare("SELECT status FROM payment_instructions WHERE id='PI-ARCH'").get().status,'PAYMENT_APPROVAL_PENDING');
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM disbursement_requests").get().n,0);
});

test('P5.8.5 any new unarchived PI makes UAT funding operational again',async()=>{
 const {db}=fixture();
 db.sqlite.exec(`INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by)
 VALUES('SUB-ARCH-NEW','ORG-P585','CLI-P585','SP-P585','STANDARD','2026-11','PAYMENT_APPROVAL_PENDING','seed');
 INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count,content_hash,provider,provider_environment,provider_account_registry_id,provider_sub_account_id)
 VALUES('PI-ARCH-NEW','ORG-P585','CLI-P585','SUB-ARCH-NEW','PAYMENT_APPROVAL_PENDING',4000000,'U-P585','IDEM-NEW',1,'HASH-NEW','E2PAY','UAT','PPA-ARCH','SUB-0190');`);
 assert.equal((await archivedUatFundingAccountIds(db,'ORG-P585')).has('PPA-ARCH'),false);
});

test('P5.8.5 anonymous/client users cannot fetch internal funding',async()=>{
 const{db,env}=fixture();const client=await createSession(db,'X-P585',env);
 assert.equal((await query(env,client.token,'/api/e2pay-disbursement-limits?operationalOnly=1')).status,403);
 assert.equal((await query(env,'invalid','/api/e2pay-disbursement-limits?operationalOnly=1')).status,401);
});

test('P5.8.5 removes screenshot-identified duplicated gateway queue and stale funding deep link',()=>{
 const root=new URL('../',import.meta.url);
 const router=readFileSync(new URL('src/components/AppWorkspaceRouter.tsx',root),'utf8');
 const ui=readFileSync(new URL('src/components/E2PayFundingLimitControl.tsx',root),'utf8');
 const client=readFileSync(new URL('src/lib/e2pay-api.ts',root),'utf8');
 assert.doesNotMatch(router,/PaymentGatewayPaymentPanel/);
 assert.match(router,/gatewayCanView=\{gatewayCanView\}/);
 assert.match(ui,/getE2PayDisbursementLimits\(\{operationalOnly:true\}\)/);
 assert.match(ui,/setAccountId\(current=>data\.funding\.some/);
 assert.match(ui,/funding-empty-operational/);
 assert.match(client,/params\.set\('operationalOnly','1'\)/);
});
