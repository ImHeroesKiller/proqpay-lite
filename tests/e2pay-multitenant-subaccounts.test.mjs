import assert from 'node:assert/strict';
import test from 'node:test';
import { D1Mock } from './helpers/d1-mock.mjs';
import { createSession } from '../functions/api/_account-auth.js';
import { onRequest as subaccounts } from '../functions/api/e2pay-subaccounts.js';

const origin='https://proqpay.test';

async function seed(){
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO organizations(id,name,slug,status) VALUES('ORG-P5','MSG','msg','ACTIVE');
    INSERT INTO clients(id,org_id,code,name,status) VALUES
      ('CLI-A','ORG-P5','A','Client A','ACTIVE'),
      ('CLI-B','ORG-P5','B','Client B','ACTIVE');
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES
      ('USR-SA','ORG-P5','Super Admin','admin@p5.test','SUPER_ADMIN','ACTIVE','hash','salt',100000,0,0,'seed'),
      ('USR-PC','ORG-P5','Controller','controller@p5.test','PAYROLL_CONTROLLER','ACTIVE','hash','salt',100000,0,1,'seed');
  `);
  const env={DB,DEFAULT_ORG_ID:'ORG-P5',AUTH_MODE:'session',SESSION_SECRET:'p5-session-secret-32-bytes-minimum-value'};
  const superSession=await createSession(DB,'USR-SA',env);
  const controllerSession=await createSession(DB,'USR-PC',env);
  return {DB,env,superSession,controllerSession};
}

function request(method,path,token,body){
  return new Request(origin+path,{
    method,
    headers:{
      Origin:origin,
      'Sec-Fetch-Site':'same-origin',
      ...(token?{Cookie:`proqpay_session=${token}`}:{}),
      ...(body?{'Content-Type':'application/json'}:{}),
    },
    ...(body?{body:JSON.stringify(body)}:{}),
  });
}

test('P5.0 schema isolates one E2Pay sub-account mapping per client/environment',async()=>{
  const {DB}=await seed();
  const cols=DB.sqlite.prepare("PRAGMA table_info(payment_provider_accounts)").all();
  assert.ok(cols.some((row)=>row.name==='provider_sub_account_id'));
  assert.ok(cols.some((row)=>row.name==='client_id'));
  assert.throws(()=>DB.sqlite.exec(`
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,created_by)
      VALUES('P1','ORG-P5','CLI-A','E2PAY','UAT','SUB_ACCOUNT','SUB-001','ACTIVE','seed');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,status,created_by)
      VALUES('P2','ORG-P5','CLI-B','E2PAY','UAT','SUB_ACCOUNT','SUB-001','ACTIVE','seed');
  `),/UNIQUE constraint failed/);
});

test('P5.1 Super Admin can create DRAFT mapping without fabricated provider id, but cannot activate it',async()=>{
  const {env,superSession}=await seed();
  let response=await subaccounts({request:request('POST','/api/e2pay-subaccounts',superSession.token,{
    action:'UPSERT_SUBACCOUNT',clientId:'CLI-A',environment:'UAT',accountName:'Client A UAT',status:'DRAFT',
  }),env});
  assert.equal(response.status,201,await response.clone().text());
  let payload=await response.json();
  assert.equal(payload.account.clientId,'CLI-A');
  assert.equal(payload.account.status,'DRAFT');
  assert.equal(payload.account.providerSubAccountId,null);

  response=await subaccounts({request:request('POST','/api/e2pay-subaccounts',superSession.token,{
    action:'SET_SUBACCOUNT_STATUS',id:payload.account.id,status:'ACTIVE',
  }),env});
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,'E2PAY_SUBACCOUNT_ID_REQUIRED');
});

test('P5.1 active mappings require unique provider sub-account id and remain read-only for Payroll Controller',async()=>{
  const {env,superSession,controllerSession}=await seed();
  let response=await subaccounts({request:request('POST','/api/e2pay-subaccounts',superSession.token,{
    action:'UPSERT_SUBACCOUNT',clientId:'CLI-A',environment:'UAT',providerSubAccountId:'SUB-UAT-A',accountName:'Client A UAT',status:'ACTIVE',
  }),env});
  assert.equal(response.status,201,await response.clone().text());

  response=await subaccounts({request:request('POST','/api/e2pay-subaccounts',superSession.token,{
    action:'UPSERT_SUBACCOUNT',clientId:'CLI-B',environment:'UAT',providerSubAccountId:'SUB-UAT-A',accountName:'Client B UAT',status:'ACTIVE',
  }),env});
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,'E2PAY_SUBACCOUNT_DUPLICATE');

  response=await subaccounts({request:request('GET','/api/e2pay-subaccounts?environment=UAT',controllerSession.token),env});
  assert.equal(response.status,200,await response.clone().text());
  const listing=await response.json();
  assert.equal(listing.accounts.length,1);
  assert.equal(listing.accounts[0].clientName,'Client A');

  response=await subaccounts({request:request('POST','/api/e2pay-subaccounts',controllerSession.token,{
    action:'UPSERT_SUBACCOUNT',clientId:'CLI-B',environment:'UAT',providerSubAccountId:'SUB-UAT-B',status:'ACTIVE',
  }),env});
  assert.equal(response.status,403);
});

test('P5.1 mapping changes write audit trail without secrets',async()=>{
  const {DB,env,superSession}=await seed();
  const response=await subaccounts({request:request('POST','/api/e2pay-subaccounts',superSession.token,{
    action:'UPSERT_SUBACCOUNT',clientId:'CLI-A',environment:'UAT',providerSubAccountId:'SUB-UAT-A1234',accountName:'Client A',status:'ACTIVE',
  }),env});
  assert.equal(response.status,201,await response.clone().text());
  const audit=DB.sqlite.prepare("SELECT action,detail FROM audit_logs WHERE entity='payment_provider_account' ORDER BY timestamp DESC LIMIT 1").get();
  assert.equal(audit.action,'E2PAY_SUBACCOUNT_MAPPING_CREATED');
  assert.match(audit.detail,/subAccountLast4=1234/);
  assert.doesNotMatch(audit.detail,/SUB-UAT-A1234/);
});
