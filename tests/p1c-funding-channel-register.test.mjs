import {readGlobalCss} from './helpers/style-sources.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {D1Mock} from './helpers/d1-mock.mjs';
import {createSession} from '../functions/api/_account-auth.js';
import {onRequest as register} from '../functions/api/canonical-transaction-register.js';
import {onRequest as channelApi} from '../functions/api/provider-channel-mappings.js';
const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

function setup(){
 const DB=new D1Mock();
 DB.sqlite.exec(`
   INSERT INTO organizations(id,name,code) VALUES('ORG-P1C','P1C','P1C');
   INSERT INTO clients(id,org_id,code,name,status) VALUES('CL-1','ORG-P1C','A','Client A','ACTIVE'),('CL-2','ORG-P1C','B','Client B','ACTIVE');
   INSERT INTO projects(id,org_id,client_id,code,name,status,created_by) VALUES('PR-1','ORG-P1C','CL-1','PR1','Project 1','ACTIVE','seed');
   INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
   VALUES('USER-P1C','ORG-P1C','Controller','controller@p1c.test','PAYROLL_CONTROLLER','ACTIVE','hash','salt',100000,0,1,'seed'),
         ('ADMIN-P1C','ORG-P1C','Admin','admin@p1c.test','SUPER_ADMIN','ACTIVE','hash','salt',100000,0,0,'seed'),
         ('CLIENT-P1C','ORG-P1C','Client','client@p1c.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed');
   INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,created_by)
   VALUES('PPA-P1C','ORG-P1C','CL-1','E2PAY','UAT','SUB_ACCOUNT','SUB-1','ACTIVE','seed');
   INSERT INTO employees(id,org_id,client_id,employee_code,name,status_aktif)
   VALUES('EMP-P1C','ORG-P1C','CL-1','EMP1','Employee','ACTIVE');
   INSERT INTO ewa_requests(id,org_id,client_id,employee_id,period,amount,status)
   VALUES('EWA-P1C','ORG-P1C','CL-1','EMP-P1C','2026-10',100,'APPROVED');
 `);
 const add=DB.sqlite.prepare(`INSERT INTO disbursement_requests(id,org_id,client_id,project_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,amount,recipient_count,client_reference,correlation_id,idempotency_key,routing_hash,status,created_by_email)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 for(let index=1;index<=127;index++){
   const id=`DR-P1C-${String(index).padStart(3,'0')}`;
   const clientId=index===126?'CL-2':'CL-1';
   add.run(id,'ORG-P1C',clientId,index===127?'PR-1':null,'E2PAY','PPA-P1C','SUB-1','UAT','EWA','DIRECT_EMPLOYEE','EMPLOYEE','EWA_REQUEST',index===127?'EWA-P1C':`EWA-OLD-${index}`,index*100,1,`P1C-REF-${index}`,`CORR-${index}`,`IDEM-${index}`,`HASH-${index}`,'READY','processor@p1c.test');
 }
 const env={DB,DEFAULT_ORG_ID:'ORG-P1C',AUTH_MODE:'session',SESSION_SECRET:'p1c-session-secret-at-least-32-characters'};
 return {DB,env};
}
async function invoke(handler,env,token,path,method='GET',body=null){
 const request=new Request('https://proqpay.test'+path,{method,headers:{Cookie:`proqpay_session=${token}`,...(body?{Origin:'https://proqpay.test','Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const response=await handler({request,env});
 return {status:response.status,data:await response.json()};
}

test('P1.C paged transaction register exposes total beyond previous 300-row cap and stable sorted pages',async()=>{
 const {DB,env}=setup();const session=await createSession(DB,'USER-P1C',env);
 const path='/api/canonical-transaction-register?pageSize=40';
 const first=await invoke(register,env,session.token,path+'&page=1');
 const second=await invoke(register,env,session.token,path+'&page=2');
 const last=await invoke(register,env,session.token,path+'&page=4');
 assert.equal(first.status,200,JSON.stringify(first.data));
 assert.equal(first.data.pagination.total,127);
 assert.equal(first.data.transactions.length,40);
 assert.equal(first.data.pagination.hasNext,true);
 assert.equal(second.data.transactions.length,40);
 assert.equal(last.data.transactions.length,7);
 assert.equal(last.data.pagination.hasNext,false);
 assert.equal(new Set([...first.data.transactions,...second.data.transactions].map(item=>item.disbursementRequestId)).size,80);
 assert.equal(first.data.pagination.totalPages,4);
});

test('P1.C register period, project, client and query stay tenant scoped and composable',async()=>{
 const {DB,env}=setup();const session=await createSession(DB,'USER-P1C',env);
 const byPeriod=await invoke(register,env,session.token,'/api/canonical-transaction-register?period=2026-10&projectId=PR-1');
 assert.equal(byPeriod.status,200,JSON.stringify(byPeriod.data));
 assert.equal(byPeriod.data.pagination.total,1);
 assert.equal(byPeriod.data.transactions[0].disbursementRequestId,'DR-P1C-127');
 const clientTwo=await invoke(register,env,session.token,'/api/canonical-transaction-register?clientId=CL-2');
 assert.equal(clientTwo.data.pagination.total,1);
 assert.equal(clientTwo.data.transactions[0].clientId,'CL-2');
 const query=await invoke(register,env,session.token,'/api/canonical-transaction-register?query=P1C-REF-126');
 assert.equal(query.data.pagination.total,1);
 assert.equal(query.data.transactions[0].clientId,'CL-2');
 const empty=await invoke(register,env,session.token,'/api/canonical-transaction-register?clientId=CL-2&projectId=PR-1');
 assert.equal(empty.data.pagination.total,0);
});

test('P1.C Payroll PI periods are resolved from payroll submissions, never assumed to exist on PI',async()=>{
 const {DB,env}=setup();
 DB.sqlite.exec(`INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by)
 VALUES('SP-P1C','CL-1','STANDARD','ACTIVE','2026-01-01','seed');
 INSERT INTO payroll_submissions(id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,state,created_by)
 VALUES('PS-P1C','ORG-P1C','CL-1','PR-1','SP-P1C','STANDARD','2026-09','2026-11','PAYMENT_APPROVAL_PENDING','seed');
 INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count)
 VALUES('PI-P1C','ORG-P1C','CL-1','PS-P1C','APPROVED_FOR_PAYMENT',100,'USER-P1C','PI-IDEMP-P1C',1);
 INSERT INTO disbursement_requests(id,org_id,client_id,project_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,amount,recipient_count,client_reference,correlation_id,idempotency_key,routing_hash,status,created_by_email)
 VALUES('DR-P1C-PI','ORG-P1C','CL-1','PR-1','E2PAY','PPA-P1C','SUB-1','UAT','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE','PAYMENT_INSTRUCTION','PI-P1C',100,1,'PAYROLL-PI-REF','CORR-PI','IDEM-PI','HASH-PI','READY','processor@p1c.test');`);
 const session=await createSession(DB,'USER-P1C',env);
 for(const month of ['2026-09','2026-11']){
  const r=await invoke(register,env,session.token,`/api/canonical-transaction-register?period=${month}&purpose=PAYROLL`);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.pagination.total,1,month);
  assert.equal(r.data.transactions[0].disbursementRequestId,'DR-P1C-PI');
 }
 const different=await invoke(register,env,session.token,'/api/canonical-transaction-register?period=2026-08&purpose=PAYROLL');
 assert.equal(different.data.pagination.total,0);
});

test('P1.C malformed page and period filters fail closed',async()=>{
 const {DB,env}=setup();const session=await createSession(DB,'USER-P1C',env);
 for(const part of ['page=0','page=99999','pageSize=101','pageSize=0','period=2026-99']){
  const result=await invoke(register,env,session.token,'/api/canonical-transaction-register?'+part);
  assert.equal(result.status,422,part);
 }
 const clientSession=await createSession(DB,'CLIENT-P1C',env);
 const scope=await invoke(register,env,clientSession.token,'/api/canonical-transaction-register?pageSize=100&clientId=CL-1');
 assert.equal(scope.status,403);
});

test('P1.C Provider Channels are read-only for Controller, and activation never assumes channel codes',async()=>{
 const {DB,env}=setup();const controller=await createSession(DB,'USER-P1C',env);
 const getter=await invoke(channelApi,env,controller.token,'/api/provider-channel-mappings?environment=UAT');
 assert.equal(getter.status,200,JSON.stringify(getter.data));
 const attempt=await invoke(channelApi,env,controller.token,'/api/provider-channel-mappings','POST',{action:'ACTIVATE_MAPPING',purpose:'PAYROLL',destinationMode:'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE',providerChannel:'invented',confirmationReference:'imaginary'});
 assert.equal(attempt.status,403);
 const admin=await createSession(DB,'ADMIN-P1C',env);
 const missingEvidence=await invoke(channelApi,env,admin.token,'/api/provider-channel-mappings','POST',{action:'ACTIVATE_MAPPING',provider:'E2PAY',environment:'UAT',purpose:'PAYROLL',destinationMode:'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE'});
 assert.equal(missingEvidence.status,410,JSON.stringify(missingEvidence.data));
 assert.equal(missingEvidence.data.code,'E2PAY_AUTOMATIC_ROUTING');
});

test('P1.C UI integrates role-safe funding health, channel evidence control and register pagination',async()=>{
 const [payment,channel,funding,reg,api,css]=await Promise.all([
  read('src/components/OperatingWorkspace.tsx'),read('src/components/ProviderChannelControl.tsx'),read('src/components/FundingReadinessSummary.tsx'),read('src/components/CanonicalTransactionRegister.tsx'),read('functions/api/canonical-transaction-register.js'),readGlobalCss(),
 ]);
 assert.doesNotMatch(payment,/FundingReadinessSummary role=\{role\}/); // P5.8.4 keeps funding inside its tab only
 assert.match(payment,/ProviderChannelControl role=\{role\}/);
 assert.match(payment,/projectId=\{projectFilter==='ALL'\?'':projectFilter\}/);
 assert.match(funding,/row.parent.ready/);
 assert.match(funding,/row.subClient.ready/);
 assert.match(funding,/row.limit.ready/);
 assert.match(funding,/accountReadiness\?\.ready/);
 assert.match(funding,/Legacy recovery/);
 assert.match(channel,/Jalur Pembayaran Otomatis/);
 assert.doesNotMatch(channel,/<input|<select|ACTIVATE_MAPPING|SAVE_DRAFT/);
 assert.match(channel,/inquiry E2Pay/);
 assert.match(reg,/pageSize:'40'/);
 assert.match(reg,/reconciliationStatus/);
 assert.match(reg,/reconciliationAttempts/);
 assert.match(reg,/Provider result/);
 assert.match(api,/LIMIT \? OFFSET \?/);
 assert.match(css,/\.funding-readiness-summary/);
 assert.match(css,/\.canonical-register-pagination/);
});
