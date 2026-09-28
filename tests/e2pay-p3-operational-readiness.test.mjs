import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildGatewayTimeline, gatewayOperationalStatus } from '../functions/api/payment-gateway.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('P3 payment timeline is derived from durable transaction and beneficiary ledger',()=>{
  const timeline=buildGatewayTimeline(
    {
      id:'PGT-1',
      provider:'E2PAY',
      status:'PROCESSING',
      created_at:'2026-09-28T10:00:00Z',
      paid_at:null,
    },
    [{
      id:'PGI-1',
      account_last4:'1234',
      client_ref:'PQP-1',
      status:'UNKNOWN',
      attempt_count:1,
      created_at:'2026-09-28T10:01:00Z',
      last_attempt_at:'2026-09-28T10:02:00Z',
      last_checked_at:'2026-09-28T10:03:00Z',
      failure_stage:'DISBURSEMENT_POST',
      error_message:'provider timeout',
    }],
  );
  assert.equal(timeline[0].type,'BENEFICIARY_STATUS');
  assert.match(timeline[0].label,/••••1234/);
  assert.ok(timeline.some((event)=>event.type==='FINANCIAL_ATTEMPT'));
  assert.ok(timeline.some((event)=>event.type==='TRANSACTION_CREATED'));
  assert.doesNotMatch(JSON.stringify(timeline),/beneficiary_name|account_number|password|token/i);
});

test('P3 payment operational state highlights unresolved and stale recovery',()=>{
  const now=Date.parse('2026-09-28T11:00:00Z');
  const status=gatewayOperationalStatus(
    {
      id:'PGT-1',
      status:'PROCESSING',
      provider_status:'AWAITING_RECONCILIATION',
      updated_at:'2026-09-28T10:30:00Z',
      execution_lock_until:null,
    },
    [{
      status:'UNKNOWN',
      updated_at:'2026-09-28T10:30:00Z',
    }],
    now,
  );
  assert.equal(status.needsReconciliation,true);
  assert.equal(status.stale,true);
  assert.equal(status.state,'STALE');
  assert.equal(status.unresolvedItems,1);
  assert.equal(status.safeToRetry,false);
});

test('P3 API and payment UI expose execution timeline without new authority path',async()=>{
  const endpoint=await read('functions/api/payment-gateway.js');
  const api=await read('src/lib/payment-gateway-api.ts');
  const ui=await read('src/components/PaymentGatewayExecutionActions.tsx');
  assert.match(endpoint,/timeline:buildGatewayTimeline\(transaction,items\)/);
  assert.match(api,/PaymentGatewayTimelineEvent/);
  assert.match(ui,/Riwayat eksekusi/);
  assert.match(ui,/runtime\.timeline\.slice\(0,30\)/);
  assert.match(endpoint,/roles: request\.method === 'POST' \? \['PAYROLL_CONTROLLER'\]/);
});

test('P3 audit control center surfaces stale, unresolved and retry-ready payment signals',async()=>{
  const endpoint=await read('functions/api/audit-logs.js');
  const ui=await read('src/components/SystemLogs.tsx');
  assert.match(endpoint,/gateway_stale/);
  assert.match(endpoint,/gateway_unresolved/);
  assert.match(endpoint,/gateway_retry_ready/);
  assert.match(endpoint,/datetime\(updated_at\)<=datetime\('now','-15 minutes'\)/);
  assert.match(ui,/Gateway stale/);
  assert.match(ui,/Unresolved beneficiary/);
  assert.match(ui,/Retry ready/);
});

test('P3 UAT dummy safety remains enforced for financial destination',async()=>{
  const dummy=await read('tests/e2pay-uat-dummy.test.mjs');
  const service=await read('functions/api/payment-gateway-e2pay-service.js');
  assert.match(dummy,/701075327/);
  assert.match(dummy,/bankId:'permata'/);
  assert.match(service,/e2payEffectiveDestination\(env,beneficiary\)/);
  assert.match(service,/\[UAT DUMMY\]/);
});
