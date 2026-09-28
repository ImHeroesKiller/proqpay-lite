import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isRetryableE2PayFailure,
  isE2PayRetryCandidate,
  selectE2PayExecutionChunk,
} from '../functions/api/payment-gateway-e2pay-service.js';
import { gatewayOperationalStatus } from '../functions/api/payment-gateway.js';

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
    status:'RETRY_READY',
    attempt_count:1,
    response_code:null,
    error_code:null,
  }),true);
  assert.equal(isE2PayRetryCandidate({
    status:'RETRY_INQUIRY_READY',
    attempt_count:1,
  }),true);
});

test('gateway endpoint exposes controller-only VERIFY_FAILED before retry',async()=>{
  const source=await read('functions/api/payment-gateway.js');
  assert.match(source,/VERIFY_FAILED/);
  assert.match(source,/verifyFailedE2PayBatch/);
  assert.match(source,/E2PAY_FAILED_ITEMS_VERIFIED/);
  assert.match(source,/RETRY_READY/);
});

test('UI shows explicit verify-before-retry recovery and provider error',async()=>{
  const source=await read('src/components/PaymentGatewayExecutionActions.tsx');
  const panel=await read('src/components/PaymentGatewayPaymentPanel.tsx');
  assert.match(source,/Verifikasi E2Pay/);
  assert.match(source,/Verifikasi Transaction History E2Pay dulu/);
  assert.match(source,/Error provider:/);
  assert.match(source,/RETRY_READY/);
  assert.match(source,/RETRY_INQUIRY_READY/);
  assert.match(source,/Retry Aman/);
  assert.match(source,/belum ada pembayaran provider dan retry terkontrol tersedia/);
  assert.match(source,/role="status"/);
  assert.match(panel,/Approval PI tetap valid meski attempt gateway gagal/);
  assert.match(panel,/APPROVED FOR PAYMENT adalah status approval PI/);
});

test('P0 retry pipeline preserves historical attempts and selects fresh retry inquiry for financial POST',()=>{
  const items=[
    {id:'safe',status:'RETRY_READY',attempt_count:1,response_code:null},
    {id:'fresh-inquiry',status:'RETRY_INQUIRY_READY',attempt_count:1,response_code:null},
    {id:'blocked',status:'FAILED',attempt_count:1,response_code:null},
  ];
  assert.deepEqual(
    selectE2PayExecutionChunk(items,25,true).map((item)=>item.id),
    ['safe','fresh-inquiry'],
  );

  const operational=gatewayOperationalStatus(
    {status:'FAILED',updated_at:new Date().toISOString()},
    [{status:'RETRY_READY',attempt_count:1,response_code:null,updated_at:new Date().toISOString()}],
  );
  assert.equal(operational.safeToRetry,true);
  assert.equal(operational.state,'RETRY_READY');
  assert.equal(operational.retryableFailedItems,1);
  assert.equal(operational.retryReadyItems,1);
});

test('P0 source uses explicit RETRY_READY -> RETRY_INQUIRY_READY -> financial POST path',async()=>{
  const service=await read('functions/api/payment-gateway-e2pay-service.js');
  const endpoint=await read('functions/api/payment-gateway.js');
  const migration=await read('migrations/0044_e2pay_retry_state_machine.sql');
  assert.match(service,/status:retryCycle \? 'RETRY_INQUIRY_READY' : 'INQUIRY_READY'/);
  assert.match(service,/retryFailed\s*\? item\.status === 'RETRY_INQUIRY_READY'/);
  assert.match(service,/attempt_count:Number\(item\.attempt_count \|\| 0\) \+ 1/);
  assert.match(endpoint,/status IN \('RETRY_READY','RETRY_INQUIRY_READY'\)/);
  assert.match(migration,/RETRY_READY/);
  assert.match(migration,/RETRY_INQUIRY_READY/);
  assert.doesNotMatch(service,/E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY/);
});
