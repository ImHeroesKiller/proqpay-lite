import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  e2payAuthorize,
  e2payBaseUrl,
  e2payDisburse,
  e2payInquirySignature,
  e2payReadiness,
  e2payResponseStatus,
  e2paySyncBeneficiaryLimit,
  resolveE2PayBank,
} from '../functions/api/payment-gateway-e2pay.js';
import { isRetryableE2PayFailure } from '../functions/api/payment-gateway-e2pay-service.js';

const baseEnv = {
  E2PAY_ENV:'UAT',
  E2PAY_CLIENT_ID:'client-id',
  E2PAY_CLIENT_SECRET:'client-secret',
  E2PAY_USERNAME:'08123456789',
  E2PAY_PASSWORD_MD5:'ABCDEF0123456789ABCDEF0123456789',
  E2PAY_ACCOUNT_SRC:'SRC-001',
  E2PAY_SOURCE_ID:'PROQPAY',
};

test('E2Pay readiness is fail-closed and environment host is fixed', () => {
  assert.equal(e2payReadiness({ E2PAY_ENV:'UAT' }).configured, false);
  assert.equal(e2payReadiness({ ...baseEnv, E2PAY_PASSWORD_MD5:'lowercase' }).configured, false);
  assert.equal(e2payReadiness(baseEnv).configured, true);
  assert.equal(e2payBaseUrl(baseEnv), 'https://disbursementtest.mbayar.co.id/switching');
  assert.equal(e2payBaseUrl({ ...baseEnv, E2PAY_ENV:'PRODUCTION' }), 'https://disbursement.mbayar.co.id/switching');
});

test('E2Pay login uses authorization-code flow and pre-hashed merchant password', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url:String(url), init });
    if (String(url).endsWith('/rest/h2h/authorization/')) {
      return new Response(JSON.stringify({ status:'SUCCESS', code:'AUTH-CODE' }), { status:200 });
    }
    return new Response(JSON.stringify({ access_token:'ACCESS', token_type:'Bearer', expires_in:'3600', refresh_token:'REFRESH' }), { status:200 });
  };
  const result = await e2payAuthorize(baseEnv, fakeFetch);
  assert.equal(result.accessToken, 'ACCESS');
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].init.body).password, baseEnv.E2PAY_PASSWORD_MD5);
  const tokenForm = new URLSearchParams(calls[1].init.body);
  assert.equal(tokenForm.get('grant_type'), 'authorization_code');
  assert.equal(tokenForm.get('code'), 'AUTH-CODE');
});

test('E2Pay inquiry signature is HMAC-SHA256 Base64 and bank mapping prefers provider id', async () => {
  const signature = await e2payInquirySignature('secret', '701075327', 'permata', 15000);
  assert.match(signature, /^[A-Za-z0-9+/]+={0,2}$/);
  const banks = [
    { id:'bca', name:'Bank Central Asia', active:true },
    { id:'permata', name:'Bank Permata', active:true },
  ];
  assert.equal(resolveE2PayBank(banks, { bankCode:'BCA', bankName:'BCA' }).id, 'bca');
  assert.equal(resolveE2PayBank(banks, { bankCode:'permata' }).id, 'permata');
  assert.equal(resolveE2PayBank(banks, { bankCode:'unknown' }), null);
});

test('E2Pay response codes are fail-closed and sync batch limit is bounded', () => {
  assert.equal(e2payResponseStatus('00'), 'SUCCEEDED');
  assert.equal(e2payResponseStatus('96'), 'PROCESSING');
  assert.equal(e2payResponseStatus('99'), 'FAILED');
  assert.equal(e2payResponseStatus(''), 'PENDING');
  assert.equal(e2payResponseStatus('UNKNOWN'), 'PENDING');
  assert.equal(e2paySyncBeneficiaryLimit({}), 25);
  assert.equal(e2paySyncBeneficiaryLimit({ E2PAY_MAX_SYNC_BENEFICIARIES:'500' }), 100);
});

test('E2Pay retry policy permits only preflight failures or provider-confirmed code 99', () => {
  assert.equal(isRetryableE2PayFailure({ status:'FAILED', attempt_count:0, response_code:null }), true);
  assert.equal(isRetryableE2PayFailure({ status:'FAILED', attempt_count:1, response_code:'99' }), true);
  assert.equal(isRetryableE2PayFailure({ status:'FAILED', attempt_count:1, response_code:null }), false);
  assert.equal(isRetryableE2PayFailure({ status:'UNKNOWN', attempt_count:1, response_code:null }), false);
  assert.equal(isRetryableE2PayFailure({ status:'SUCCEEDED', attempt_count:1, response_code:'00' }), false);
});

test('financial POST is attempted once; ambiguous network failure is not auto-retried', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    throw new Error('network down');
  };
  await assert.rejects(
    e2payDisburse(baseEnv, 'ACCESS', {
      clientRef:'PQP-123',
      description:'Payroll',
      inquiryId:'INQ-1',
    }, fakeFetch),
    /Koneksi ke E2Pay gagal/,
  );
  assert.equal(calls, 1);
});

test('E2Pay migration and gateway endpoint keep beneficiary-level ledger and safe recovery', async () => {
  const migration = await readFile(new URL('../migrations/0025_e2pay_disbursement.sql', import.meta.url), 'utf8');
  const endpoint = await readFile(new URL('../functions/api/payment-gateway.js', import.meta.url), 'utf8');
  const service = await readFile(new URL('../functions/api/payment-gateway-e2pay-service.js', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE payment_gateway_items/);
  assert.match(migration, /UNIQUE \(provider, client_ref\)/);
  assert.match(migration, /provider_beneficiary_name/);
  assert.match(endpoint, /RECONCILE/);
  assert.match(endpoint, /RETRY_FAILED/);
  assert.match(endpoint, /E2PAY_NO_RETRYABLE_FAILURES/);
  assert.match(endpoint, /E2PAY_BATCH_REQUIRES_QUEUE/);
  assert.match(service, /E2PAY_INSUFFICIENT_BALANCE/);
  assert.match(service, /E2PAY_INQUIRY_CONTROL_MISMATCH/);
  assert.match(service, /UNKNOWN/);
  assert.match(service, /e2payTransactionHistory/);
  assert.match(service, /Number\(error\.httpStatus\) >= 500/);
  assert.doesNotMatch(service, /emptyIsSuccess:true/);
});
