import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isRetryableE2PayFailure } from '../functions/api/payment-gateway-e2pay-service.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('E2Pay failed HTTP 4xx needs provider verification before retry',()=>{
  assert.equal(isRetryableE2PayFailure({
    status:'FAILED',
    attempt_count:1,
    response_code:null,
    error_code:'E2PAY_HTTP_ERROR',
    error_message:'E2Pay HTTP 400',
  }),false);

  assert.equal(isRetryableE2PayFailure({
    status:'FAILED',
    attempt_count:1,
    response_code:null,
    error_code:'E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY',
  }),true);
});

test('gateway endpoint exposes controller-only VERIFY_FAILED before retry',async()=>{
  const source=await read('functions/api/payment-gateway.js');
  assert.match(source,/VERIFY_FAILED/);
  assert.match(source,/verifyFailedE2PayBatch/);
  assert.match(source,/E2PAY_FAILED_ITEMS_VERIFIED/);
  assert.match(source,/E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY/);
});

test('UI shows explicit verify-before-retry recovery and provider error',async()=>{
  const source=await read('src/components/PaymentGatewayExecutionActions.tsx');
  const panel=await read('src/components/PaymentGatewayPaymentPanel.tsx');
  assert.match(source,/Verifikasi E2Pay/);
  assert.match(source,/Verifikasi Transaction History E2Pay dulu/);
  assert.match(source,/Error provider:/);
  assert.match(source,/E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY/);
  assert.match(panel,/Approval PI tetap valid meski attempt gateway gagal/);
  assert.match(panel,/APPROVED FOR PAYMENT adalah status approval PI/);
});
