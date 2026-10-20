import {D1Mock} from './d1-mock.mjs';
import {createSession,passwordRecord} from '../../functions/api/_account-auth.js';

export function masterFixture(count=1){
 const database=new D1Mock();
 const env={DB:database,AUTH_MODE:'session',DEFAULT_ORG_ID:'ORG-FIX',SESSION_SECRET:'test-session-secret-32-characters-long',PI_ENCRYPTION_KEY:'test-encryption-key-32-characters-long',PAYMENT_GATEWAY_PROVIDER:'E2PAY',E2PAY_ENV:'UAT',E2PAY_CLIENT_ID:'mock',E2PAY_CLIENT_SECRET:'mock',E2PAY_USERNAME:'mock',E2PAY_PASSWORD_MD5:'A'.repeat(32),E2PAY_ACCOUNT_SRC:'PROVIDER-MASTER',E2PAY_SOURCE_ID:'MOCK-SOURCE',__e2payAudit:async()=>{}};
 database.sqlite.exec(`
 INSERT INTO organizations(id,name,code) VALUES('ORG-FIX','Test','FIX');
 INSERT INTO clients(id,org_id,code,name,status) VALUES('C-FIX','ORG-FIX','CLI','Client','ACTIVE');
 INSERT INTO employees(id,org_id,client_id,employee_code,name,status_aktif) VALUES('E-FIX','ORG-FIX','C-FIX','EMP','Test','ACTIVE');
 INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('SP-FIX','C-FIX','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');
 INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by) VALUES('PS-FIX','ORG-FIX','C-FIX','SP-FIX','TIER_1_PAYMENT_PROCESSING','2026-10','APPROVED_FOR_PAYMENT','seed');
 INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,content_hash,recipient_count) VALUES('PI-FIX','ORG-FIX','C-FIX','PS-FIX','APPROVED_FOR_PAYMENT',${count*1000},'processor','PI-IDEM','PI-HASH',${count});
 INSERT INTO payment_provider_accounts(id,org_id,provider,environment,account_scope,provider_account_id,status,created_by) VALUES('MASTER-FIX','ORG-FIX','E2PAY','UAT','MASTER','PROVIDER-MASTER','ACTIVE','seed');
 INSERT INTO disbursement_requests(id,org_id,client_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,amount,recipient_count,client_reference,correlation_id,idempotency_key,routing_hash,status,approved_by_email,approved_at,created_by_email)
 VALUES('DR-FIX','ORG-FIX','C-FIX','E2PAY','MASTER-FIX','PROVIDER-MASTER','UAT','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE','PAYMENT_INSTRUCTION','PI-FIX',${count*1000},${count},'REF-FIX','CORR-FIX','IDEM-FIX','HASH-FIX','PROCESSING','controller@test','2026-10-12T00:00:00Z','processor@test');
 INSERT INTO disbursement_executions(id,org_id,client_id,disbursement_request_id,provider,provider_account_registry_id,provider_channel,status,amount,idempotency_key,request_hash,created_by)
 VALUES('DX-FIX','ORG-FIX','C-FIX','DR-FIX','E2PAY','MASTER-FIX','TEST','PROCESSING',${count*1000},'DX-IDEM','DX-HASH','controller@test');
 `);
 for(let i=1;i<=count;i++){
 database.sqlite.prepare(`INSERT INTO payment_instruction_lines(id,payment_instruction_id,beneficiary_name,bank_name,bank_code,masked_account,account_ciphertext,account_iv,account_last4,line_hash,amount) VALUES(?,'PI-FIX','Test','BCA','BCA','****1234','cipher','iv','1234',?,1000)`).run('LINE-'+i,'HASH-'+i);
 database.sqlite.prepare(`INSERT INTO disbursement_request_items(id,disbursement_request_id,sequence_no,source_item_type,source_item_id,beneficiary_type,beneficiary_reference,employee_id,bank_code,beneficiary_name,account_number_ciphertext,account_number_iv,account_number_hash,account_number_last4,beneficiary_hash,amount,client_reference) VALUES(?,'DR-FIX',?,'PAYMENT_INSTRUCTION_LINE',?,'EMPLOYEE',?,'E-FIX','BCA','Test','cipher','iv','hash','1234','beneficiary',1000,?)`).run('RI-'+i,i,'LINE-'+i,'E-'+i,'REF-'+i);
 database.sqlite.prepare(`INSERT INTO disbursement_execution_items(id,disbursement_execution_id,disbursement_request_item_id,provider,client_ref,beneficiary_name,account_last4,amount,status,inquiry_id) VALUES(?,'DX-FIX',?,'E2PAY',?,'Test','1234',1000,'INQUIRY_READY',?)`).run('XI-'+i,'RI-'+i,'REF-'+i,'INQ-'+i);
 }
 const request=database.sqlite.prepare("SELECT * FROM disbursement_requests WHERE id='DR-FIX'").get();
 const execution=database.sqlite.prepare("SELECT * FROM disbursement_executions WHERE id='DX-FIX'").get();
 const requestItems=database.sqlite.prepare('SELECT * FROM disbursement_request_items ORDER BY sequence_no').all();
 return {database,env,request,execution,requestItems,channelSnapshot:{providerChannel:'TEST'}};
}

export function mockProvider(t,{payment='success',history='00'}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const path=new URL(url).pathname;calls.push({path,method:init.method||'GET',body:init.body});
  let result;
  if(path.endsWith('/authorization/'))result={code:'mock-code'};
  else if(path.endsWith('/token'))result={access_token:'mock-token'};
  else if(path.endsWith('/account'))result={accountId:'PROVIDER-MASTER',merchantStatus:'ACTIVE',balance:1e9};
  else if(path.endsWith('/bank/sdp'))result={data:[{id:'bca',name:'BCA'}]};
  else if(path.endsWith('/sdp/transaction')){
   if(payment==='timeout')throw new DOMException('timeout','AbortError');
   if(payment==='invalid-json')return new Response('not-json',{status:200});
   result={responseCode:payment==='reject'?'99':'00',journalId:'JOURNAL-MOCK'};
  }else if(path.endsWith('/me/transaction'))result={data:history===null?[]:[{clientRef:new URL(url).searchParams.get('clientRef'),responseCode:history,journalId:'JOURNAL-MOCK'}]};
  else throw new Error('Unexpected network path: '+path);
  return new Response(JSON.stringify(result),{status:200});
 });
 return {calls,posts:()=>calls.filter(c=>c.path.endsWith('/sdp/transaction'))};
}

export async function roleSession(f,role,{mfa=true}={}){
 const id='U-'+role;
 const pass=await passwordRecord('Test-Only-Password!2026');
 f.database.sqlite.prepare(`INSERT OR IGNORE INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by) VALUES(?,'ORG-FIX',?,?,?,'ACTIVE',?,?,?,0,1,'seed')`).run(id,role,role.toLowerCase()+'@example.test',role,pass.hash,pass.salt,pass.iterations);
 const session=await createSession(f.database,id,f.env,{mfaVerifiedAt:mfa?new Date().toISOString():null});
 return {Cookie:`proqpay_session=${session.token}`,Origin:'https://proqpay.test','Content-Type':'application/json'};
}
