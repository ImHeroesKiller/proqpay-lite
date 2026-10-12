import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { createSession } from '../functions/api/_account-auth.js';
import { onRequest as beneficiaryApi } from '../functions/api/client-bank-beneficiaries.js';
import { roleCanAction } from '../shared/authority-matrix.js';

const drApi=await readFile(new URL('../functions/api/disbursement-requests.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/CorporateBeneficiaryPanel.tsx',import.meta.url),'utf8');

function request(token,body){
  return new Request('https://proqpay.test/api/client-bank-beneficiaries',{method:'POST',headers:{Origin:'https://proqpay.test','Sec-Fetch-Site':'same-origin','Content-Type':'application/json',Cookie:`proqpay_session=${token}`},body:JSON.stringify(body)});
}

async function seed(){
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-577','MSG','M577');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-577','ORG-577','C577','PT Client 577','ACTIVE');
    INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES
      ('USR-P577','ORG-577','Processor','processor@577.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed'),
      ('USR-C577','ORG-577','Controller','controller@577.test','PAYROLL_CONTROLLER','ACTIVE','hash','salt',100000,0,1,'seed');
  `);
  const env={DB,DEFAULT_ORG_ID:'ORG-577',AUTH_MODE:'session',SESSION_SECRET:'p577-session-secret-at-least-32-chars',PI_ENCRYPTION_KEY:'p577-pi-encryption-key-at-least-32-characters',SECURITY_MFA_ENFORCEMENT:'AUDIT'};
  const processor=await createSession(DB,'USR-P577',env);
  const controller=await createSession(DB,'USR-C577',env);
  return {DB,env,processor,controller};
}

test('P5.7.7 authority matrix separates corporate beneficiary maker and checker',()=>{
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','corporate-beneficiary.request'),true);
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','corporate-beneficiary.approve'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','corporate-beneficiary.request'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','corporate-beneficiary.approve'),true);
});

test('P5.7.7 Processor request -> Controller approval creates governed verified primary',async()=>{
  const {DB,env,processor,controller}=await seed();
  let response=await beneficiaryApi({request:request(processor.token,{action:'REQUEST_PRIMARY_ACCOUNT',clientId:'CLI-577',bankCode:'BCA',bankName:'Bank Central Asia',accountName:'PT Client 577',accountNumber:'1234567890',reason:'Initial corporate payroll settlement account'}),env});
  assert.equal(response.status,201,await response.clone().text());
  const submitted=await response.json();
  assert.equal(submitted.change.action,'CREATE_PRIMARY');
  assert.equal(submitted.change.status,'PENDING_APPROVAL');
  assert.equal(submitted.change.accountLast4,'7890');
  assert.doesNotMatch(JSON.stringify(submitted),/1234567890/);

  response=await beneficiaryApi({request:request(controller.token,{action:'APPROVE_CHANGE',id:submitted.change.id,verificationReference:'CALLBACK-577-A'}),env});
  assert.equal(response.status,200,await response.clone().text());
  const approved=await response.json();
  assert.equal(approved.account.status,'VERIFIED');
  assert.equal(approved.account.isPrimary,true);
  assert.equal(approved.account.governed,true);
  assert.equal(approved.account.verificationVersion,1);
  const row=DB.sqlite.prepare("SELECT * FROM client_bank_accounts WHERE client_id='CLI-577'").get();
  assert.equal(row.source_change_request_id,submitted.change.id);
  assert.equal(row.last_change_request_id,submitted.change.id);
  assert.throws(()=>DB.sqlite.prepare("UPDATE client_bank_accounts SET account_name='Tampered' WHERE id=?").run(row.id),/immutable/);
  assert.throws(()=>DB.sqlite.prepare("UPDATE client_bank_accounts SET is_primary=0 WHERE id=?").run(row.id),/approved change request/);
});

test('P5.7.7 replacement atomically suspends old primary and activates new governed primary',async()=>{
  const {DB,env,processor,controller}=await seed();
  async function createAndApprove(accountNumber,ref,reason){
    let response=await beneficiaryApi({request:request(processor.token,{action:'REQUEST_PRIMARY_ACCOUNT',clientId:'CLI-577',bankCode:'MANDIRI',bankName:'Bank Mandiri',accountName:'PT Client 577',accountNumber,reason}),env});
    assert.equal(response.status,201,await response.clone().text());
    const change=(await response.json()).change;
    response=await beneficiaryApi({request:request(controller.token,{action:'APPROVE_CHANGE',id:change.id,verificationReference:ref}),env});
    assert.equal(response.status,200,await response.clone().text());
    return {change,approved:await response.json()};
  }
  const first=await createAndApprove('111122223333','VERIFY-A','Initial verified settlement beneficiary');
  const firstId=first.approved.account.id;
  const second=await createAndApprove('999988887777','VERIFY-B','Replace settlement account after bank change');
  assert.equal(second.change.action,'REPLACE_PRIMARY');
  const rows=DB.sqlite.prepare("SELECT id,status,is_primary,account_number_last4,last_change_request_id FROM client_bank_accounts WHERE client_id='CLI-577' ORDER BY created_at,id").all();
  assert.equal(rows.length,2);
  const old=rows.find(r=>r.id===firstId);
  const current=rows.find(r=>r.id!==firstId);
  assert.equal(old.status,'SUSPENDED');
  assert.equal(Number(old.is_primary),0);
  assert.equal(old.last_change_request_id,second.change.id);
  assert.equal(current.status,'VERIFIED');
  assert.equal(Number(current.is_primary),1);
  assert.equal(current.account_number_last4,'7777');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS c FROM client_bank_accounts WHERE client_id='CLI-577' AND status='VERIFIED' AND is_primary=1").get().c,1);
});

test('P5.7.7 corporate DR source accepts only governed approved primary beneficiary',()=>{
  assert.match(drApi,/JOIN client_bank_account_change_requests cr ON cr\.id=cba\.source_change_request_id/);
  assert.match(drApi,/cba\.verification_version>0/);
  assert.match(drApi,/cr\.status='APPROVED'/);
  assert.match(drApi,/belum VERIFIED, governed, dan PRIMARY/);
});

test('P5.7.7 UI never displays full stored account number and exposes maker-checker workflow',()=>{
  assert.match(ui,/Corporate Settlement Account/);
  assert.match(ui,/maker-checker/);
  assert.match(ui,/Ajukan ke Controller/);
  assert.match(ui,/Approve & Verify/);
  assert.match(ui,/primary\.bankCode.*primary\.accountLast4/);
  assert.doesNotMatch(ui,/account_number_ciphertext|account_number_iv/);
});
