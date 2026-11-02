import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Mock } from './helpers/d1-mock.mjs';
import { createSession } from '../functions/api/_account-auth.js';
import { onRequest } from '../functions/api/ewa.js';
import { ewaEligibility } from '../functions/api/_ewa.js';

async function fixture(){
 const DB=new D1Mock();
 DB.sqlite.exec(`INSERT INTO organizations(id,name,code) VALUES('O','Org','O');
 INSERT INTO clients(id,org_id,name,code) VALUES('C','O','Client','C'),('X','O','Other','X');
 INSERT INTO projects(id,org_id,client_id,name,code,created_by) VALUES('P','O','C','Project','P','seed'),('Q','O','X','Other','Q','seed');
 INSERT INTO employees(id,org_id,client_id,project_id,name) VALUES('E','O','C','P','Employee'),('F','O','X','Q','Other');
 INSERT INTO app_users(id,org_id,name,email,role,status,must_change_password,created_by,password_hash,password_salt,password_iterations) VALUES
 ('CLIENT','O','Client','client@test','CLIENT_USER','ACTIVE',0,'seed','unused','unused',100000),
 ('EMPTY','O','No scope','empty@test','CLIENT_USER','ACTIVE',0,'seed','unused','unused',100000),
 ('OPS','O','Processor','ops@test','PAYROLL_PROCESSOR','ACTIVE',0,'seed','unused','unused',100000);
 INSERT INTO user_client_scopes(user_id,client_id) VALUES('CLIENT','C');
 INSERT INTO user_project_scopes(user_id,project_id) VALUES('CLIENT','P');
 INSERT INTO ewa_requests(id,org_id,client_id,employee_id,period,amount,status) VALUES
 ('R','O','C','E','2026-10',200000,'SUBMITTED'),('S','O','X','F','2026-10',200000,'SUBMITTED');`);
 const env={DB,AUTH_MODE:'session',DEFAULT_ORG_ID:'O',SESSION_SECRET:'client-ewa-test-secret-long-enough'};
 const cookies={};for(const id of ['CLIENT','EMPTY','OPS']) cookies[id]=`proqpay_session=${(await createSession(DB,id,env)).token}`;
 const call=(who,body,query="")=>onRequest({env,request:new Request('https://proqpay.test/api/ewa'+query,{method:body?'POST':'GET',headers:{Cookie:cookies[who],Origin:'https://proqpay.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})});
 return {DB,call};
}
test('client approval is scoped and precedes internal approval; client cannot internally approve',async()=>{
 const {DB,call}=await fixture();
 let r=await call('OPS',{id:'R',action:'APPROVE'});assert.equal(r.status,409);assert.equal((await r.json()).code,'EWA_CLIENT_APPROVAL_REQUIRED');
 r=await call('CLIENT');let data=await r.json();assert.equal(r.status,200,JSON.stringify(data));assert.deepEqual(data.requests.map(x=>x.id),['R']);assert.equal(data.total,1);assert.equal(data.clients.length,1);
 r=await call('EMPTY');assert.equal((await r.json()).requests.length,0);
 r=await call('CLIENT',{id:'S',action:'APPROVE'});assert.equal(r.status,404);
 r=await call('CLIENT',{id:'R',action:'APPROVE'});assert.equal(r.status,200,await r.clone().text());data=await r.json();assert.equal(data.request.status,'SUBMITTED');assert.equal(data.request.client_approval_status,'APPROVED');
 r=await call('CLIENT',{id:'R',action:'APPROVE'});assert.equal(r.status,409);
 r=await call('OPS',{id:'R',action:'APPROVE'});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).request.status,'APPROVED');
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id='R'").get().n,2);
});
test('client rejection prevents internal approval and database prevents bypass',async()=>{
 const {DB,call}=await fixture();
 assert.throws(()=>DB.sqlite.exec("UPDATE ewa_requests SET status='APPROVED' WHERE id='R'"),/EWA_CLIENT_APPROVAL_REQUIRED/);
 let r=await call('CLIENT',{id:'R',action:'REJECT',note:'Tidak disetujui klien'});assert.equal(r.status,200);assert.equal((await r.json()).request.status,'REJECTED');
 r=await call('OPS',{id:'R',action:'APPROVE'});assert.equal(r.status,409);
});
test('paid payroll does not exclude eligible employees but workday, tenure and plafond requirements remain',()=>{
 const input={policy:{enabled:1,min_tenure_months:1,min_days_worked:10},daysWorked:15,tenureMonths:12,tenureDays:365,plafond:500000,paid:true};
 assert.equal(ewaEligibility(input).eligible,true);
 for(const change of [{daysWorked:1},{tenureMonths:0},{plafond:0},{active:false},{openRequest:{id:'existing'}}])assert.equal(ewaEligibility({...input,...change}).eligible,false);
});

test('rejection requires a reason, follows client consent and stores the audited decision',async()=>{
 const {DB,call}=await fixture();
 for(const note of ['', '    ', 'x'.repeat(241)]){const r=await call('CLIENT',{id:'R',action:'REJECT',note});assert.equal(r.status,422);}
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id='R'").get().n,0);
 let r=await call('OPS',{id:'R',action:'REJECT',note:'Perlu koreksi data'});assert.equal(r.status,409);assert.equal((await r.json()).code,'EWA_CLIENT_APPROVAL_REQUIRED');
 await call('CLIENT',{id:'R',action:'APPROVE'});
 r=await call('OPS',{id:'R',action:'REJECT',note:'Perlu koreksi data'});assert.equal(r.status,200);const row=(await r.json()).request;assert.equal(row.status,'REJECTED');assert.equal(row.decision_note,'Perlu koreksi data');assert.equal(row.decided_by,'ops@test');assert.ok(row.decided_at);
 const audit=DB.sqlite.prepare("SELECT detail FROM audit_logs WHERE action='EWA_REJECTED' AND entity_id='R'").get();assert.equal(JSON.parse(audit.detail).note,'Perlu koreksi data');
});

test('summary and status counters use scoped client/search filters but do not collapse to the selected status',async()=>{
 const {call}=await fixture();
 const data=await (await call('OPS',null,'?clientId=C&status=APPROVED')).json();assert.equal(data.requests.length,0);assert.equal(data.total,1);assert.equal(data.statusCounts.SUBMITTED,1);assert.equal(data.clients.length,2);
 const searched=await (await call('OPS',null,'?q=Other')).json();assert.equal(searched.requests.length,1);assert.equal(searched.total,1);assert.equal(searched.statusCounts.SUBMITTED,1);
 const scoped=await (await call('CLIENT',null,'?clientId=X')).json();assert.equal(scoped.total,0);assert.equal(scoped.requests.length,0);
});

test('duplicate client rejection is rejected and leaves a single audit event',async()=>{
 const {DB,call}=await fixture();const decisions=await Promise.all([call('CLIENT',{id:'R',action:'REJECT',note:'Dokumen belum sesuai'}),call('CLIENT',{id:'R',action:'REJECT',note:'Dokumen belum sesuai'})]);
 assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_id='R'").get().n,1);
});
