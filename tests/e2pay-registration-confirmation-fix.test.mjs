import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  e2payRegisterConfirm,
  e2payRegisterRequest,
} from '../functions/api/payment-gateway-e2pay.js';

const api=await readFile(new URL('../functions/api/e2pay-subaccounts.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const client=await readFile(new URL('../src/lib/e2pay-api.ts',import.meta.url),'utf8');

test('E2Pay registration request follows provider host-token contract and preserves challenge response',async()=>{
  let captured=null;
  const result=await e2payRegisterRequest(
    {E2PAY_ENV:'UAT',E2PAY_SOURCE_ID:'SRC-UAT',E2PAY_PARTNER_ID:'PARTNER-UAT'},
    'host-token',
    {phone:'08123456789',name:'Client UAT',email:'ops@example.test'},
    async(url,init)=>{
      captured={url,init};
      return new Response(JSON.stringify({
        merchantRegistrationId:'REG-1234',
        tokenPrefix:'AbC',
        username:'08123456789',
        accountGroupId:'GROUP-1',
      }),{status:200,headers:{'Content-Type':'application/json'}});
    },
  );
  assert.match(captured.url,/\/b2b\/merchant\/register\/request$/);
  assert.equal(captured.init.headers.Authorization,'Bearer host-token');
  assert.deepEqual(JSON.parse(captured.init.body),{
    phone:'08123456789',
    name:'Client UAT',
    email:'ops@example.test',
    partnerId:'PARTNER-UAT',
    sourceId:'SRC-UAT',
  });
  assert.equal(result.username,'08123456789');
  assert.equal(result.tokenPrefix,'AbC');
  assert.equal(result.merchantRegistrationId,'REG-1234');
});

test('E2Pay provider confirmation protocol still sends plain provider password and token',async()=>{
  let captured=null;
  const result=await e2payRegisterConfirm(
    {E2PAY_ENV:'UAT'},
    'host-token',
    {username:'08123456789',password:'Aa1!bc',token:'AbC1234'},
    async(url,init)=>{
      captured={url,init};
      return new Response(JSON.stringify({merchantId:'MERCHANT-1'}),{status:200,headers:{'Content-Type':'application/json'}});
    },
  );
  assert.match(captured.url,/\/b2b\/merchant\/register\/confirm$/);
  assert.equal(captured.init.headers.Authorization,'Bearer host-token');
  assert.deepEqual(JSON.parse(captured.init.body),{
    username:'08123456789',
    password:'Aa1!bc',
    token:'AbC1234',
  });
  assert.equal(result.merchantId,'MERCHANT-1');
});

test('sub-account API distinguishes host auth from register request failures',()=>{
  assert.match(api,/stage:'HOST_AUTH'/);
  assert.match(api,/stage:'REGISTER_REQUEST'/);
  assert.doesNotMatch(api,/error\?\.httpStatus===401\|\|error\?\.httpStatus===403\?'HOST_AUTH'/);
});

test('registration challenge is persisted server-side while UI exposes only OTP activation',()=>{
  assert.match(api,/provider_provisioning_sessions/);
  assert.match(api,/provider_username/);
  assert.match(api,/token_prefix/);
  assert.match(client,/activateE2PaySubAccount/);
  assert.match(ui,/Verifikasi OTP & Aktifkan/);
  assert.match(ui,/Kirim ulang OTP aktivasi/);
  assert.match(api,/encryptProviderProvisioningSecret/);
  assert.match(api,/encryptProviderAccountCredential/);
  assert.doesNotMatch(ui,/Password baru/);
});

test('confirmation password policy fails before provider call',()=>{
  assert.match(api,/password\.length<6\|\|password\.length>12/);
  assert.match(api,/E2PAY_CONFIRM_PASSWORD_POLICY/);
});


test('submerchant registration pairing contract is explicit for client and project routing',()=>{
  assert.match(api,/pairing:\{/);
  assert.match(api,/scope:projectId\?'PROJECT_OVERRIDE':'CLIENT'/);
  assert.match(api,/stage:'REGISTRATION_CONFIG'/);
  assert.match(client,/providerMessage/);
  assert.match(client,/correlationId/);
  assert.match(ui,/Host credential MSG digunakan otomatis/);
});


test('zero-friction activation composes provider token only in the backend',()=>{
  assert.match(api,/composeProvisioningToken\(session\.token_prefix,otp\)/);
  assert.doesNotMatch(ui,/composeE2PayRegistrationToken/);
});

test('confirmation can resolve provider account identity through the new merchant login when confirm response omits it',()=>{
  assert.match(api,/normalizeE2PayPassword\(password\)/);
  assert.match(api,/E2PAY_USERNAME:username/);
  assert.match(api,/await e2payAuthorize\(merchantRuntimeEnv\)/);
  assert.match(api,/await e2payMerchantAccount\(merchantRuntimeEnv,merchantAuth\.accessToken\)/);
  assert.match(api,/stage:'CONFIRM_ACCOUNT_LOOKUP'/);
});
