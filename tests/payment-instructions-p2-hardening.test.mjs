import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gatewayOperationalStatus } from '../functions/api/payment-gateway.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Payment Instructions P2 derives stale and reconciliation-required gateway state',()=>{
  const now=Date.parse('2026-09-24T12:30:00.000Z');
  const status=gatewayOperationalStatus({
    id:'PGT-1',status:'PROCESSING',updated_at:'2026-09-24T12:00:00.000Z',execution_lock_until:null,
  },[
    {status:'UNKNOWN',last_checked_at:'2026-09-24T12:05:00.000Z'},
  ],now);
  assert.equal(status.state,'STALE');
  assert.equal(status.stale,true);
  assert.equal(status.needsReconciliation,true);
  assert.equal(status.safeToRetry,false);
  assert.equal(status.unresolvedItems,1);
  assert.equal(status.staleMinutes,25);
});

test('Payment Instructions P2 does not mark an active execution lease stale',()=>{
  const now=Date.parse('2026-09-24T12:30:00.000Z');
  const status=gatewayOperationalStatus({
    id:'PGT-2',status:'PROCESSING',updated_at:'2026-09-24T12:00:00.000Z',execution_lock_until:'2026-09-24T12:35:00.000Z',
  },[],now);
  assert.equal(status.activeLease,true);
  assert.equal(status.stale,false);
});

test('Payment Instructions P2 only permits retry status when failures are deterministic',()=>{
  const now=Date.parse('2026-09-24T12:30:00.000Z');
  const safe=gatewayOperationalStatus({
    id:'PGT-3',status:'FAILED',updated_at:'2026-09-24T12:29:00.000Z',
  },[
    {status:'FAILED',attempt_count:1,response_code:'99',updated_at:'2026-09-24T12:29:00.000Z'},
  ],now);
  assert.equal(safe.safeToRetry,true);

  const unsafe=gatewayOperationalStatus({
    id:'PGT-4',status:'FAILED',updated_at:'2026-09-24T12:29:00.000Z',
  },[
    {status:'UNKNOWN',attempt_count:1,response_code:'',updated_at:'2026-09-24T12:29:00.000Z'},
  ],now);
  assert.equal(unsafe.safeToRetry,false);
  assert.equal(unsafe.needsReconciliation,true);
});

test('Payment Instructions P2 validates recipient count again at execution boundary',async()=>{
  const api=await read('functions/api/payment-gateway.js');
  assert.match(api,/PAYMENT_RECIPIENT_COUNT_MISMATCH/);
  assert.match(api,/instruction_count/);
  assert.match(api,/recipient_count/);
});

test('Payment Instructions P2 fails closed when generic gateway result is uncertain',async()=>{
  const api=await read('functions/api/payment-gateway.js');
  assert.match(api,/GATEWAY_EXECUTION_UNKNOWN/);
  assert.match(api,/AWAITING_PROVIDER_CONFIRMATION/);
  assert.match(api,/requiresProviderConfirmation/);
  assert.match(api,/GATEWAY_EXECUTION_UNCERTAIN/);
  assert.doesNotMatch(api,/catch \(error\) \{\s*await d1Batch\(database, \[\{ statement: `UPDATE payment_gateway_transactions SET status='FAILED'/);
});

test('Payment Instructions P2 audits E2Pay uncertain and failed execution outcomes',async()=>{
  const api=await read('functions/api/payment-gateway.js');
  assert.match(api,/E2PAY_EXECUTION_UNCERTAIN/);
  assert.match(api,/E2PAY_EXECUTION_FAILED/);
  assert.match(api,/auditOperation/);
});

test('Payment Instructions P2 hardens manual proof fallback',async()=>{
  const proof=await read('functions/api/payment-proof.js');
  assert.match(proof,/PAYMENT_GATEWAY_AMBIGUOUS_FAILURE/);
  assert.match(proof,/PAYMENT_PROOF_TOTAL_EXCEEDS_PI/);
  assert.match(proof,/PAYMENT_PROOF_FUTURE_DATE/);
  assert.match(proof,/provider_transaction_id IS NOT NULL/);
  assert.match(proof,/UPPER\(COALESCE\(error_code,''\)\) LIKE '%UNKNOWN%'/);
});

test('Payment Instructions P2 exposes actionable operational state in UI',async()=>{
  const ui=await read('src/components/PaymentGatewayExecutionActions.tsx');
  const detail=await read('src/components/OperatingWorkspace.tsx');
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(ui,/Status gateway stale/);
  assert.match(ui,/Sync status sekarang/);
  assert.match(ui,/Hasil eksekusi belum pasti/);
  assert.match(ui,/window\.confirm/);
  assert.match(detail,/OPERATIONAL AUDIT/);
  assert.match(detail,/Activity trail/);
  assert.match(api,/FROM audit_logs WHERE org_id=\? AND entity='payment_instruction'/);
});
