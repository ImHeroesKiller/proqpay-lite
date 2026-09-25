import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  e2payBankListPage,
  e2payChangePhoneConfirm,
  e2payChangePhoneRequest,
  e2payChangePassword,
  e2payLogout,
  e2payRefreshAccessToken,
  e2payRegisterConfirm,
  e2payRegisterRequest,
  e2payResetPasswordConfirm,
  e2payResetPasswordRequest,
  e2payTransactionHistoryList,
} from '../functions/api/payment-gateway-e2pay.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');
const env={
  E2PAY_ENV:'UAT',
  E2PAY_CLIENT_ID:'client',
  E2PAY_CLIENT_SECRET:'secret',
  E2PAY_PARTNER_ID:'0041',
  E2PAY_SOURCE_ID:'MANDIRIS',
  E2PAY_USERNAME:'6281510000006',
  E2PAY_PASSWORD_MD5:'0123456789ABCDEF0123456789ABCDEF',
};

function mockJson(body={}){
  const calls=[];
  const fetchImpl=async(url,init={})=>{
    calls.push({url:String(url),init});
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  };
  return {calls,fetchImpl};
}

test('E2Pay v1.1 merchant API primitives map canonical endpoints',async()=>{
  {
    const {calls,fetchImpl}=mockJson({access_token:'new-token',token_type:'Bearer',expires_in:'3600',refresh_token:'new-refresh'});
    const result=await e2payRefreshAccessToken(env,'refresh-1',fetchImpl);
    assert.equal(result.accessToken,'new-token');
    assert.match(calls[0].url,/\/rest\/oauth\/token$/);
    assert.match(String(calls[0].init.body),/grant_type=refresh_token/);
  }
  {
    const {calls,fetchImpl}=mockJson({merchantRegistrationId:'MR-1'});
    await e2payRegisterRequest(env,'host',{phone:'0812',name:'PT Test',email:'a@test.id'},fetchImpl);
    assert.match(calls[0].url,/\/b2b\/merchant\/register\/request$/);
  }
  {
    const {calls,fetchImpl}=mockJson({merchantId:'M-1'});
    await e2payRegisterConfirm(env,'host',{username:'0812',password:'Aa1!xx',token:'abc123'},fetchImpl);
    assert.match(calls[0].url,/\/b2b\/merchant\/register\/confirm$/);
  }
  {
    const {calls,fetchImpl}=mockJson({});
    await e2payChangePassword(env,'user',{username:'0812',password:'Old1!',newPassword:'New1!'},fetchImpl);
    assert.match(calls[0].url,/\/b2b\/merchant\/me\/auth\/password$/);
    assert.equal(calls[0].init.method,'PUT');
  }
  {
    const {calls,fetchImpl}=mockJson({tokenPrefix:'jKK'});
    await e2payResetPasswordRequest(env,'host',{email:'a@test.id',username:'0812',accountGroupId:'AG-1'},fetchImpl);
    assert.match(calls[0].url,/\/b2b\/merchant\/auth\/password\/resetRequest$/);
  }
  {
    const {calls,fetchImpl}=mockJson({});
    await e2payResetPasswordConfirm(env,'host',{email:'a@test.id',username:'0812',accountGroupId:'AG-1',token:'jKK1234',newPassword:'New1!'},fetchImpl);
    assert.match(calls[0].url,/\/b2b\/merchant\/auth\/password\/resetConfirm$/);
  }
  {
    const {calls,fetchImpl}=mockJson({tokenPrefix:'jKK'});
    await e2payChangePhoneRequest(env,'user',{username:'0812',password:'Old1!',phone:'0813'},fetchImpl);
    assert.match(calls[0].url,/\/b2b\/merchant\/me\/phone\/updateRequest$/);
  }
  {
    const {calls,fetchImpl}=mockJson({});
    await e2payChangePhoneConfirm(env,'user',{token:'jKK1234',phone:'0813'},fetchImpl);
    assert.match(calls[0].url,/\/b2b\/merchant\/me\/phone\/updateConfirm$/);
    assert.equal(calls[0].init.method,'PUT');
  }
  {
    const {calls,fetchImpl}=mockJson({status:'SUCCESS',code:'00'});
    await e2payLogout(env,'user',fetchImpl);
    assert.match(calls[0].url,/\/rest\/oauth\/token\/logout$/);
  }
});

test('E2Pay bank list and transaction history expose provider filters without token leakage',async()=>{
  {
    const {calls,fetchImpl}=mockJson({rowCount:1,data:[{id:'bca',name:'BCA',active:true}]});
    const result=await e2payBankListPage(env,'user',{name:'BCA',limit:25},fetchImpl);
    assert.equal(result.rowCount,1);
    assert.match(calls[0].url,/\/b2b\/bank\/sdp\?/);
    assert.match(calls[0].url,/name=BCA/);
  }
  {
    const {calls,fetchImpl}=mockJson({rowCount:1,data:[{clientRef:'PQP-1',responseCode:'00'}]});
    const result=await e2payTransactionHistoryList(env,'user',{clientRef:'PQP-1',responseCode:'00',transactionTimestampFrom:'2026-09-01 00:00:00'},fetchImpl);
    assert.equal(result.data.length,1);
    assert.match(calls[0].url,/\/b2b\/merchant\/me\/transaction\?/);
    assert.match(calls[0].url,/clientRef=PQP-1/);
    assert.doesNotMatch(JSON.stringify(result),/access_token|refresh_token/i);
  }
});

test('E2Pay operations API covers all v1.1 functions and blocks raw disbursement',async()=>{
  const source=await read('functions/api/e2pay-operations.js');
  for(const id of [
    'HOST_AUTH','REGISTER_REQUEST','REGISTER_CONFIRM','AUTHORIZE','ACCESS_TOKEN','REFRESH_TOKEN',
    'ACCOUNT','TRANSACTIONS','CHANGE_PASSWORD','RESET_PASSWORD_REQUEST','RESET_PASSWORD_CONFIRM',
    'CHANGE_PHONE_REQUEST','CHANGE_PHONE_CONFIRM','INQUIRY','DISBURSEMENT','VERIFY_USERNAME','LOGOUT','BANKS',
  ]) assert.match(source,new RegExp(id));
  assert.match(source,/E2PAY_PAYMENT_CONTROL_REQUIRED/);
  assert.match(source,/maker-checker/);
  assert.match(source,/payment_gateway_provider_snapshots/);
});

test('Dashboard surfaces E2Pay merchant balance and refreshes it with dashboard refresh',async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/getE2PayOverview/);
  assert.match(source,/E2Pay balance/);
  assert.match(source,/loadGatewayBalance\(true\)/);
  assert.match(source,/gatewayAccount\.balance/);
});

test('Integrations exposes account, endpoint catalog, history, banks, inquiry and merchant admin',async()=>{
  const panel=await read('src/components/PaymentGatewayIntegrationPanel.tsx');
  const consoleSource=await read('src/components/E2PayOperationsConsole.tsx');
  assert.match(panel,/E2PayOperationsConsole/);
  assert.match(consoleSource,/Available balance/);
  assert.match(consoleSource,/API endpoint coverage/);
  assert.match(consoleSource,/Transaction history/);
  assert.match(consoleSource,/Bank directory/);
  assert.match(consoleSource,/Disbursement inquiry/);
  assert.match(consoleSource,/Merchant registration/);
  assert.match(consoleSource,/Password administration/);
  assert.match(consoleSource,/Phone number administration/);
  assert.match(consoleSource,/Test refresh token/);
  assert.match(consoleSource,/Test logout/);
});

test('E2Pay provider snapshot migration stores only masked public account metadata',async()=>{
  const migration=await read('migrations/0040_e2pay_provider_snapshot.sql');
  assert.match(migration,/payment_gateway_provider_snapshots/);
  assert.match(migration,/balance REAL/);
  assert.match(migration,/phone_masked/);
  assert.doesNotMatch(migration,/access_token|refresh_token|client_secret|password/i);
});


test('E2Pay live-read hardening prevents snapshot bind regression and tolerates UAT sort rejection',async()=>{
  const operationsSource=await read('functions/api/e2pay-operations.js');
  assert.match(
    operationsSource,
    /VALUES\(\?,'E2PAY',\?,\?,\?,\?,\?,\?,\?,\?,\?,'PROVIDER'/,
    'snapshot insert must bind exactly org + 9 provider fields',
  );
  assert.doesNotMatch(
    operationsSource,
    /VALUES\(\?,'E2PAY',\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,'PROVIDER'/,
    'snapshot insert must not regress to 14 values for 13 columns',
  );

  const calls=[];
  const fetchImpl=async(url,init={})=>{
    calls.push({url:String(url),init});
    if(calls.length===1){
      return new Response(JSON.stringify({message:'invalid sort'}),{
        status:400,
        headers:{'Content-Type':'application/json'},
      });
    }
    return new Response(JSON.stringify({rowCount:1,data:[{clientRef:'PQP-1',responseCode:'00'}]}),{
      status:200,
      headers:{'Content-Type':'application/json'},
    });
  };
  const result=await e2payTransactionHistoryList(
    env,
    'user',
    {limit:5,sortField:'transactionTimestamp',sortOrder:'DESCENDING',clientRef:'PQP-1'},
    fetchImpl,
  );
  assert.equal(calls.length,2);
  assert.match(calls[0].url,/sortField=transactionTimestamp/);
  assert.doesNotMatch(calls[1].url,/sortField=/);
  assert.match(calls[1].url,/clientRef=PQP-1/);
  assert.equal(result.rowCount,1);
});

test('E2Pay bank directory normalizes provider status to active',async()=>{
  const {fetchImpl}=mockJson({rowCount:2,data:[
    {id:'aceh_syr',name:'BANK ACEH SYARIAH',status:false},
    {id:'airpay',name:'BANK AIRPAY INTERNATIONAL',status:true},
  ]});
  const result=await e2payBankListPage(env,'user',{limit:5},fetchImpl);
  assert.equal(result.data[0].active,false);
  assert.equal(result.data[1].active,true);
});
