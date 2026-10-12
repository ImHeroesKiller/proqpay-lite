import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readFile} from 'node:fs';
import {D1Mock} from './helpers/d1-mock.mjs';
import {createSession} from '../functions/api/_account-auth.js';
import {onRequest as cutoverApi} from '../functions/api/legacy-data-cutover.js';
const migration=readFileSync(new URL('../migrations/0069_p583_credentialless_legacy_data_cutover.sql',import.meta.url),'utf8');

function fixture(){
 const db=new D1Mock();
 db.sqlite.exec(`
  INSERT INTO organizations(id,name,code) VALUES('ORG-P583','Test','P583');
  INSERT INTO clients(id,org_id,code,name,status) VALUES('CLIENT-P583','ORG-P583','P583','Test Client','ACTIVE');
  INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
   VALUES('USER-P583','ORG-P583','Processor','processor@p583.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
         ('CLIENTUSER-P583','ORG-P583','Client User','client@p583.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
  INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('SP-P583','CLIENT-P583','STANDARD','ACTIVE','2026-01-01','seed');
  INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by)
   VALUES('SUB-P583','ORG-P583','CLIENT-P583','SP-P583','STANDARD','2026-10','PAYMENT_APPROVAL_PENDING','seed');
  INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,provisioning_state,created_by)
   VALUES('PPA-UAT-583','ORG-P583','CLIENT-P583','E2PAY','UAT','SUB_ACCOUNT','SUB-583','ACTIVE','PROVISIONED','seed'),
         ('PPA-PROD-583','ORG-P583','CLIENT-P583','E2PAY','PRODUCTION','SUB_ACCOUNT','SUB-PROD','ACTIVE','PROVISIONED','seed');
  INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count,content_hash,provider,provider_environment,provider_account_registry_id,provider_sub_account_id)
   VALUES('PI-P583','ORG-P583','CLIENT-P583','SUB-P583','PAYMENT_APPROVAL_PENDING',15900000,'USER-P583','PIIDEM-P583',1,'HASH-PI-583','E2PAY','UAT','PPA-UAT-583','SUB-583');
  INSERT INTO payment_instruction_lines(id,payment_instruction_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount)
   VALUES('PIL-P583','PI-P583','Employee','BCA','014','••••1234','ciphertext-private','iv-private','1234','LINEHASH',15900000);
 `);
 const env={DB:db,DEFAULT_ORG_ID:'ORG-P583',AUTH_MODE:'session',SESSION_SECRET:'p583-test-session-secret-at-least-32-characters'};
 return{db,env};
}
async function api(env,token,method='GET'){
 const response=await cutoverApi({request:new Request('https://proqpay.test/api/legacy-data-cutover',{method,headers:{Cookie:`proqpay_session=${token}`}}),env});
 return{status:response.status,data:await response.json()};
}

test('P5.8.3 data cutover references original UAT PI/provider ID and preserves immutable sources',async()=>{
 const {db,env}=fixture();
 db.sqlite.exec(migration);
 const before={pi:db.sqlite.prepare("SELECT COUNT(*) AS n,SUM(expected_total) AS amount FROM payment_instructions WHERE id='PI-P583'").get(),accounts:db.sqlite.prepare("SELECT COUNT(*) AS n FROM payment_provider_accounts WHERE org_id='ORG-P583'").get().n};
 const rows=db.sqlite.prepare("SELECT * FROM legacy_data_cutover_records WHERE org_id='ORG-P583' ORDER BY source_type").all();
 assert.equal(rows.length,2); // one UAT provider and one PI, excludes PRODUCTION E2Pay provider.
 assert.deepEqual(new Set(rows.map(row=>row.source_type)),new Set(['UAT_PROVIDER_ACCOUNT','UAT_PAYMENT_INSTRUCTION']));
 assert(rows.every(row=>row.source_account_id==='PPA-UAT-583'&&row.environment==='UAT'&&row.execution_allowed===0));
 assert.equal(rows.find(row=>row.source_type==='UAT_PAYMENT_INSTRUCTION').amount_idr,15900000);
 assert.equal(rows.find(row=>row.source_type==='UAT_PAYMENT_INSTRUCTION').source_id,'PI-P583');
 db.sqlite.exec(migration); // idempotent, no duplicate or mutable source
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM legacy_data_cutover_records').get().n,2);
 assert.deepEqual(db.sqlite.prepare("SELECT COUNT(*) AS n,SUM(expected_total) AS amount FROM payment_instructions WHERE id='PI-P583'").get(),before.pi);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM payment_provider_accounts WHERE org_id='ORG-P583'").get().n,before.accounts);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM disbursement_requests').get().n,0);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_gateway_transactions').get().n,0);
 assert.throws(()=>db.sqlite.exec("DELETE FROM legacy_data_cutover_records WHERE source_id='PI-P583'"),/LEGACY_DATA_CUTOVER_IMMUTABLE/);
 assert.throws(()=>db.sqlite.exec("UPDATE legacy_data_cutover_records SET cutover_status='DATA_ONLY' WHERE source_id='PI-P583'"),/LEGACY_DATA_CUTOVER_IMMUTABLE/);
});

test('P5.8.3 API shows credentialless data in new flow and never permits execution/deletion',async()=>{
 const{db,env}=fixture();db.sqlite.exec(migration);
 const session=await createSession(db,'USER-P583',env);
 const result=await api(env,session.token);
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.environment,'UAT');
 assert.equal(result.data.mode,'DATA_ONLY_NON_EXECUTABLE');
 assert.equal(result.data.summary.accounts,1);
 assert.equal(result.data.summary.instructions,1);
 assert.equal(result.data.summary.instructionTotalIdr,15900000);
 assert.equal(result.data.credentialRequiredToView,false);
 assert.equal(result.data.providerDisbursementEnabled,false);
 assert.equal(result.data.reset.eligible,false);
 assert(result.data.records.every(row=>row.originalRowsRetained&&row.executionAllowed===false&&row.hardDeleteAllowed===false));
 assert(!JSON.stringify(result.data).includes('ciphertext-private'));
 assert(!JSON.stringify(result.data).includes('iv-private'));
 assert.equal((await api(env,session.token,'POST')).status,405);
 const restricted=await createSession(db,'CLIENTUSER-P583',env);
 assert.equal((await api(env,restricted.token)).status,403);
});

test('P5.8.3 migration is strictly UAT scoped and does not delete or alter credentials, PI, gateway, balances, audit',()=>{
 assert.match(migration,/ppa\.environment='UAT'/);
 assert.match(migration,/pi\.provider_environment='UAT'/);
 assert.match(migration,/CHECK\(execution_allowed=0\)/);
 assert.match(migration,/original_rows_retained INTEGER NOT NULL DEFAULT 1/);
 assert.doesNotMatch(migration,/DELETE FROM|UPDATE payment_provider_accounts|UPDATE payment_instructions|DROP TABLE|INSERT INTO disbursement_requests|INSERT INTO disbursement_executions/);
});

test('P5.8.3 frontend renders clear data-only status without payment or reset action',async()=>{
 const ui=await readFileSync(new URL('../src/components/LegacyDataCutoverPanel.tsx',import.meta.url),'utf8');
 const main=await readFileSync(new URL('../src/components/CanonicalDisbursementWorkspace.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(main,/LegacyDataCutoverPanel/); // P5.8.4 hides archived UAT technical widgets from payment screen
 assert.match(ui,/Tidak bisa transfer/);
 assert.match(ui,/credentialless/);
 assert.doesNotMatch(ui,/action:'EXECUTE'|action:'DELETE'|fetch\([^\n]*method:'POST'/);
});
