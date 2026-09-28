import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  e2payExecutionContract,
  e2payExecutionDiagnostics,
} from '../functions/api/payment-gateway-e2pay.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

const env={
  E2PAY_ENV:'UAT',
  E2PAY_ACCOUNT_SRC:'1234560004',
  E2PAY_SOURCE_ID:'MANDIRIS',
  E2PAY_PASSWORD_MD5:'5F4DCC3B5AA765D61D8327DEB882CF99',
};

test('P1 execution contract fails closed when accountSrc differs from merchant account',()=>{
  const valid=e2payExecutionContract(env,{accountId:'1234560004'});
  assert.equal(valid.valid,true);
  assert.equal(valid.accountSrcMatchesMerchant,true);
  assert.equal(valid.sourceIdConfigured,true);
  assert.equal(valid.sourceIdVerification,'PROVIDER_ISSUED_CONFIG_ONLY');

  const mismatch=e2payExecutionContract(env,{accountId:'9999990004'});
  assert.equal(mismatch.valid,false);
  assert.equal(mismatch.accountSrcMatchesMerchant,false);
  assert.ok(mismatch.issues.includes('E2PAY_ACCOUNT_SRC_MISMATCH'));
});

test('P1 diagnostics are useful but never persist raw accountSrc, sourceId, password, or inquiryId',async()=>{
  const diagnostics=await e2payExecutionDiagnostics(env,{
    clientRef:'PQP-1234567890abcdef1234567890ab',
    description:'UAT DUMMY PI 209901 ABCD',
    inquiryId:'INQUIRY-SECRET-123',
  },{accountId:'1234560004'});
  const serialized=JSON.stringify(diagnostics);
  assert.equal(diagnostics.accountSrc?.last4,'0004');
  assert.equal(diagnostics.accountSrc?.matchesMerchantAccount,true);
  assert.equal(diagnostics.clientRef?.length,32);
  assert.equal(diagnostics.clientRef?.ascii,true);
  assert.equal(diagnostics.password?.md5Uppercase,true);
  assert.doesNotMatch(serialized,/1234560004/);
  assert.doesNotMatch(serialized,/MANDIRIS/);
  assert.doesNotMatch(serialized,/5F4DCC3B5AA765D61D8327DEB882CF99/);
  assert.doesNotMatch(serialized,/INQUIRY-SECRET-123/);
});

test('P1 service persists sanitized financial-attempt observability and blocks account mismatch',async()=>{
  const service=await read('functions/api/payment-gateway-e2pay-service.js');
  assert.match(service,/e2payExecutionContract\(env,merchant\)/);
  assert.match(service,/E2PAY_ACCOUNT_SRC_MISMATCH/);
  assert.match(service,/request_diagnostics_json:JSON\.stringify\(requestDiagnostics\)/);
  assert.match(service,/provider_http_status:error instanceof E2PayRequestError/);
  assert.match(service,/failure_stage:'DISBURSEMENT_POST'/);
  assert.match(service,/last_attempt_at:new Date\(\)\.toISOString\(\)/);
});

test('P1 API and UI expose only sanitized request diagnostics and separate approval from gateway state',async()=>{
  const endpoint=await read('functions/api/payment-gateway.js');
  const actions=await read('src/components/PaymentGatewayExecutionActions.tsx');
  const panel=await read('src/components/PaymentGatewayPaymentPanel.tsx');
  const operations=await read('src/components/E2PayOperationsConsole.tsx');
  assert.match(endpoint,/publicGatewayItem/);
  assert.match(endpoint,/request_diagnostics_json/);
  assert.match(actions,/Diagnostik request E2Pay/);
  assert.match(actions,/tidak menyimpan password, token, full accountSrc, atau raw sourceId/);
  assert.match(actions,/Gateway ·/);
  assert.match(panel,/Approval ·/);
  assert.match(operations,/Execution contract/);
  assert.match(operations,/Source ID berasal dari provisioning E2Pay/);
});

test('P1 migration adds observability columns without storing sensitive payload fields',async()=>{
  const migration=await read('migrations/0045_e2pay_execution_observability.sql');
  assert.match(migration,/provider_http_status/);
  assert.match(migration,/failure_stage/);
  assert.match(migration,/request_diagnostics_json/);
  assert.match(migration,/last_attempt_at/);
  assert.doesNotMatch(migration,/password/i);
  assert.doesNotMatch(migration,/access_token/i);
  assert.doesNotMatch(migration,/client_secret/i);
});
