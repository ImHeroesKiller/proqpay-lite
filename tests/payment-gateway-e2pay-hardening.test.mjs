import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  e2payHostReadiness,
  e2payLoginReadiness,
  e2payReadiness,
} from '../functions/api/payment-gateway-e2pay.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('E2Pay readiness has separate host, merchant-login, and execution gates',()=>{
  const host={
    E2PAY_ENV:'UAT',
    E2PAY_CLIENT_ID:'client',
    E2PAY_CLIENT_SECRET:'secret',
  };
  assert.equal(e2payHostReadiness(host).configured,true);
  assert.equal(e2payLoginReadiness(host).configured,false);

  const login={
    ...host,
    E2PAY_USERNAME:'merchant-user',
    E2PAY_PASSWORD_MD5:'5F4DCC3B5AA765D61D8327DEB882CF99',
  };
  assert.equal(e2payLoginReadiness(login).configured,true);
  assert.equal(e2payReadiness(login).configured,false);

  const executable={...login,E2PAY_ACCOUNT_SRC:'701000001',E2PAY_SOURCE_ID:'SOURCE-UAT'};
  assert.equal(e2payReadiness(executable).configured,true);
});

test('full beneficiary preflight is completed before the first financial POST',async()=>{
  const source=await read('functions/api/payment-gateway-e2pay-service.js');
  const phase1=source.indexOf('Phase 1: finish beneficiary inquiry/preflight for the full immutable PI');
  const remainingPreflight=source.indexOf('remainingPreflight',phase1);
  const balanceCheck=source.indexOf('remainingRequired',remainingPreflight);
  const financialPost=source.indexOf('e2payDisburse(',balanceCheck);
  assert.ok(phase1>=0);
  assert.ok(remainingPreflight>phase1);
  assert.ok(balanceCheck>remainingPreflight);
  assert.ok(financialPost>balanceCheck);
  assert.match(source,/allItems\.filter\(\(item\) => item\.status === 'CREATED'\)/);
  assert.match(source,/Preflight seluruh beneficiary harus lolos sebelum disbursement pertama/);
  assert.match(source,/merchantBalance < remainingRequired/);
});

test('provider ambiguity never becomes a blind retry after a financial POST',async()=>{
  const source=await read('functions/api/payment-gateway-e2pay-service.js');
  const pending=source.indexOf("status:'PENDING'");
  const post=source.indexOf('e2payDisburse(',pending);
  const persistenceUnknown=source.indexOf('E2PAY_RESULT_PERSISTENCE_UNKNOWN',post);
  assert.ok(pending>=0 && post>pending);
  assert.ok(persistenceUnknown>post);
  assert.match(source,/wajib reconcile sebelum retry/);
  assert.match(source,/PENDING remains durable and blocks a blind retry/);
});

test('gateway endpoint serializes reconciliation and hides execution internals',async()=>{
  const source=await read('functions/api/payment-gateway.js');
  assert.match(source,/action === 'RECONCILE'.*e2payLoginReadiness/s);
  assert.match(source,/const reconcileLease = await acquireExecutionLease/);
  assert.match(source,/releaseExecutionLease\(database, transaction\.id, reconcileLease\)/);
  assert.match(source,/PAYMENT_GATEWAY_REQUEST_MISMATCH/);
  assert.match(source,/execution_lock_token,/);
  assert.match(source,/request_hash,/);
  assert.match(source,/idempotency_key,/);
  assert.match(source,/transaction:publicTransaction\(transaction\)/);
});

test('E2Pay UI can recover preflight failures without looping forever',async()=>{
  const source=await read('src/components/PaymentGatewayExecutionActions.tsx');
  assert.match(source,/continuationCalls < 100/);
  assert.match(source,/progress === previousProgress/);
  assert.match(source,/e2payRetryable > 0 && e2payUnresolved === 0/);
  assert.doesNotMatch(source,/e2payRetryable > 0 && e2payUnresolved === 0 && e2payReady === 0/);
  assert.match(source,/e2payReady > 0 && e2payFailed === 0/);
  assert.match(source,/role="alert"/);
});
