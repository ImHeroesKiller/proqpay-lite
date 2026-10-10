import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { composeProvisioningToken, generateManagedMerchantPassword, provisioningDisplayState } from '../functions/api/e2pay-provisioning-orchestrator.js';

const api=await readFile(new URL('../functions/api/e2pay-subaccounts.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const credentials=await readFile(new URL('../functions/api/payment-provider-account-credentials.js',import.meta.url),'utf8');

test('P5.7.1 managed password satisfies E2Pay policy without user input',()=>{
  for(let index=0;index<20;index++){
    const value=generateManagedMerchantPassword();
    assert.equal(value.length,12);
    assert.match(value,/[A-Z]/);
    assert.match(value,/[a-z]/);
    assert.match(value,/[0-9]/);
    assert.match(value,/[^A-Za-z0-9]/);
  }
});

test('P5.7.1 OTP composer accepts OTP-only and already-prefixed provider tokens',()=>{
  assert.equal(composeProvisioningToken('AbC','1234'),'AbC1234');
  assert.equal(composeProvisioningToken('AbC','abc1234'),'abc1234');
  assert.equal(composeProvisioningToken('AbC',' 12 34 '),'AbC1234');
});

test('P5.7.1 display state is durable and fail-closed for legacy provisioned accounts',()=>{
  assert.equal(provisioningDisplayState({sessionState:'OTP_REQUIRED'}),'OTP_REQUIRED');
  assert.equal(provisioningDisplayState({accountStatus:'ACTIVE',providerSubAccountId:'SUB1',credentialReady:true}),'READY');
  assert.equal(provisioningDisplayState({accountStatus:'ACTIVE',providerSubAccountId:'SUB1',credentialReady:false}),'MANUAL_REVIEW');
});

test('P5.7.1 schema enforces one durable provisioning session per provider registry',()=>{
  const db=new D1Mock();
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-57','MSG','MSG57');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-57','ORG-57','C57','Client 57','ACTIVE');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,account_name,status,created_by)
      VALUES('PPA-57','ORG-57','CLI-57','E2PAY','UAT','SUB_ACCOUNT','Client 57','DRAFT','seed');
    INSERT INTO provider_provisioning_sessions(id,org_id,client_id,provider,environment,provider_account_registry_id,state,created_by)
      VALUES('PPS-1','ORG-57','CLI-57','E2PAY','UAT','PPA-57','OTP_REQUIRED','seed');
  `);
  assert.throws(()=>db.sqlite.exec(`INSERT INTO provider_provisioning_sessions(id,org_id,client_id,provider,environment,provider_account_registry_id,state,created_by) VALUES('PPS-2','ORG-57','CLI-57','E2PAY','UAT','PPA-57','OTP_REQUIRED','seed')`),/UNIQUE constraint failed/);
});

test('P5.7.1 API persists provider challenge server-side and exposes only OTP-safe public state',()=>{
  assert.match(api,/provider_provisioning_sessions/);
  assert.match(api,/state='ACTIVATING'/);
  assert.match(api,/state='READY'/);
  assert.match(api,/E2PAY_PROVISIONING_OTP_REQUESTED/);
  assert.match(api,/E2PAY_PROVISIONING_READY/);
  assert.match(api,/ACTIVATE_SUBACCOUNT/);
  assert.match(api,/credentialMode:'SERVICE_MANAGED'/);
  assert.doesNotMatch(api,/registration:\{[\s\S]{0,200}username:registrationUsername/);
  assert.doesNotMatch(api,/registration:\{[\s\S]{0,200}tokenPrefix/);
});

test('P5.7.1 activation keeps generated secret encrypted during resumable provider confirmation',()=>{
  assert.match(credentials,/encryptProviderProvisioningSecret/);
  assert.match(credentials,/decryptProviderProvisioningSecret/);
  assert.match(api,/pendingProvisioningSecret/);
  assert.match(api,/pendingProvisioningSecret:null/);
});

test('P5.7.1 UI asks only for OTP during normal activation',()=>{
  const start=ui.indexOf('function renderE2PayPendingConfirmation');
  const end=ui.indexOf('const canCreateProject',start);
  const flow=ui.slice(start,end);
  assert.match(flow,/Verifikasi OTP & Aktifkan/);
  assert.match(flow,/Username, password merchant, dan token prefix dikelola otomatis/);
  assert.doesNotMatch(flow,/Password baru/);
  assert.doesNotMatch(flow,/Token prefix<input/);
  assert.doesNotMatch(flow,/Username E2Pay<input/);
});

import { createSession } from '../functions/api/_account-auth.js';
import { onRequest as subaccountsApi } from '../functions/api/e2pay-subaccounts.js';

async function p571Seed(){
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-571','MSG','MSG571');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-571','ORG-571','C571','Client 571','ACTIVE');
    INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES('USR-571','ORG-571','Processor','processor@571.test','PAYROLL_PROCESSOR','ACTIVE','hash','salt',100000,0,0,'seed');
  `);
  const env={
    DB,DEFAULT_ORG_ID:'ORG-571',AUTH_MODE:'session',SESSION_SECRET:'p571-session-secret-32-bytes-minimum',
    E2PAY_ENV:'UAT',E2PAY_CLIENT_ID:'host-client',E2PAY_CLIENT_SECRET:'host-secret',
    E2PAY_SOURCE_ID:'MANDIRISG',E2PAY_PARTNER_ID:'PARTNER',
    E2PAY_CREDENTIALS_KEY:'p571-credential-key-at-least-32-characters',
  };
  const session=await createSession(DB,'USR-571',env);
  return {DB,env,session};
}

function p571Request(token,body){
  return new Request('https://proqpay.test/api/e2pay-subaccounts',{
    method:'POST',headers:{Origin:'https://proqpay.test','Sec-Fetch-Site':'same-origin','Content-Type':'application/json',Cookie:`proqpay_session=${token}`},
    body:JSON.stringify(body),
  });
}

test('P5.7.1 integration: Register -> OTP -> Activate -> Ready without user-managed credential',async()=>{
  const {DB,env,session}=await p571Seed();
  const originalFetch=globalThis.fetch;
  let confirmed=false;
  let generatedPassword='';
  globalThis.fetch=async(url,init={})=>{
    const target=String(url);
    if(target.endsWith('/rest/oauth/token')){
      const body=String(init.body||'');
      return new Response(JSON.stringify({access_token:body.includes('client_credentials')?'host-token':'merchant-token',token_type:'Bearer'}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(target.endsWith('/b2b/merchant/register/request')){
      return new Response(JSON.stringify({merchantRegistrationId:'REG-571',tokenPrefix:'AbC',username:'08123456789',accountGroupId:'GROUP-571'}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(target.endsWith('/rest/h2h/authorization/')){
      if(!confirmed) return new Response(JSON.stringify({message:'not active'}),{status:401,headers:{'Content-Type':'application/json'}});
      return new Response(JSON.stringify({status:'OK',code:'AUTH-571'}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(target.endsWith('/b2b/merchant/register/confirm')){
      const body=JSON.parse(String(init.body||'{}'));
      generatedPassword=body.password;
      assert.equal(body.username,'08123456789');
      assert.equal(body.token,'AbC1234');
      assert.match(body.password,/[A-Z]/); assert.match(body.password,/[a-z]/); assert.match(body.password,/[0-9]/); assert.match(body.password,/[^A-Za-z0-9]/);
      confirmed=true;
      return new Response(JSON.stringify({merchantId:'MERCHANT-571'}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(target.endsWith('/b2b/merchant/me/account')){
      return new Response(JSON.stringify({accountId:'MERCHANT-571',accountName:'Client 571',balance:25000000}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    throw new Error(`Unexpected E2Pay URL ${target}`);
  };
  try{
    let response=await subaccountsApi({request:p571Request(session.token,{action:'REGISTER_SUBACCOUNT',clientId:'CLI-571',environment:'UAT',phone:'08123456789',email:'ops@571.test'}),env});
    assert.equal(response.status,202,await response.clone().text());
    const registered=await response.json();
    assert.equal(registered.registration.state,'OTP_REQUIRED');
    assert.equal(registered.registration.phoneLast4,'6789');
    assert.equal('username' in registered.registration,false);
    assert.equal('tokenPrefix' in registered.registration,false);
    const sessionRow=DB.sqlite.prepare("SELECT * FROM provider_provisioning_sessions WHERE provider_account_registry_id=?").get(registered.account.id);
    assert.equal(sessionRow.state,'OTP_REQUIRED');
    assert.equal(sessionRow.provider_username,'08123456789');
    assert.equal(sessionRow.token_prefix,'AbC');

    response=await subaccountsApi({request:p571Request(session.token,{action:'ACTIVATE_SUBACCOUNT',id:registered.account.id,otp:'1234'}),env});
    assert.equal(response.status,200,await response.clone().text());
    const activated=await response.json();
    assert.equal(activated.provisioning.state,'READY');
    assert.equal(activated.account.status,'ACTIVE');
    assert.equal(activated.account.merchantCredential.ready,true);
    assert.equal(activated.account.availableBalance,25000000);
    const finalSession=DB.sqlite.prepare("SELECT * FROM provider_provisioning_sessions WHERE provider_account_registry_id=?").get(registered.account.id);
    assert.equal(finalSession.state,'READY');
    const account=DB.sqlite.prepare("SELECT * FROM payment_provider_accounts WHERE id=?").get(registered.account.id);
    assert.doesNotMatch(String(account.metadata_json),new RegExp(generatedPassword.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(String(account.metadata_json),/merchantCredential/);
    assert.match(String(account.metadata_json),/"pendingProvisioningSecret":null/);
  } finally {
    globalThis.fetch=originalFetch;
  }
});
