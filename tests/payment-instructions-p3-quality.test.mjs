import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Payment Instructions P3 centralizes presentation logic and typed contracts',async()=>{
  const helper=await read('src/lib/payment-instruction-ui.ts');
  const api=await read('src/lib/operating-model-api.ts');
  const workspace=await read('src/components/OperatingWorkspace.tsx');

  assert.match(helper,/export type PaymentInstructionDetail/);
  assert.match(helper,/paymentInstructionIntegrity/);
  assert.match(helper,/summarizePaymentBanks/);
  assert.match(helper,/filterPaymentInstructionLines/);
  assert.match(helper,/paymentActivityLabel/);
  assert.match(helper,/shortPaymentHash/);

  assert.match(api,/Promise<PaymentInstructionDetail>/);
  assert.doesNotMatch(api,/getPaymentInstructionDetail\(paymentInstructionId: string\):Promise<any>/);

  assert.match(workspace,/useState<PaymentInstructionDetail \| null>/);
  assert.match(workspace,/summarizePaymentBanks\(detailLines\)/);
  assert.match(workspace,/filterPaymentInstructionLines\(detailLines,detailQuery,detailBank\)/);
  assert.match(workspace,/paymentInstructionIntegrity\(detail\)/);
});

test('Payment Instructions P3 keeps one canonical payment business label map',async()=>{
  const helper=await read('src/lib/payment-instruction-ui.ts');
  const workspace=await read('src/components/OperatingWorkspace.tsx');

  assert.match(helper,/PAYMENT_STATUS_LABELS/);
  assert.match(helper,/PAYMENT_APPROVAL_PENDING:'For Approval'/);
  assert.match(helper,/APPROVED_FOR_PAYMENT:'Ready to Pay'/);
  assert.match(helper,/RECONCILIATION:'Reconcile'/);
  assert.doesNotMatch(workspace,/function paymentBusinessLabel\(/);
  assert.match(workspace,/mode==='payments'\?paymentBusinessLabel/);
});

test('Payment Instructions P3 improves governance and audit readability',async()=>{
  const workspace=await read('src/components/OperatingWorkspace.tsx');
  const helper=await read('src/lib/payment-instruction-ui.ts');

  assert.match(workspace,/paymentActivityLabel\(item.action\)/);
  assert.match(workspace,/dateTime\(approval.created_at\)/);
  assert.match(workspace,/dateTime\(item.timestamp\)/);
  assert.match(helper,/GATEWAY_EXECUTION_UNCERTAIN:'Status gateway belum pasti'/);
  assert.match(helper,/E2PAY_RECONCILED:'Status E2Pay disinkronkan'/);
});

test('Payment Instructions P3 keeps approval readiness derived from one integrity helper',async()=>{
  const workspace=await read('src/components/OperatingWorkspace.tsx');
  const helper=await read('src/lib/payment-instruction-ui.ts');

  assert.match(helper,/approvalReady:valid&&detail\?\.paymentInstruction\?\.status==='PAYMENT_APPROVAL_PENDING'/);
  assert.match(workspace,/disabled={!approvalConfirmed \|\| !integrity.approvalReady}/);
  assert.match(workspace,/pi-integrity-panel \$\{integrity.valid/);
});

test('Payment Instructions P3 avoids exposing a full content hash as primary visual text',async()=>{
  const workspace=await read('src/components/OperatingWorkspace.tsx');
  const helper=await read('src/lib/payment-instruction-ui.ts');

  assert.match(workspace,/shortPaymentHash\(detail.paymentInstruction.content_hash\)/);
  assert.match(workspace,/title={detail.paymentInstruction.content_hash \|\| undefined}/);
  assert.match(helper,/hash.slice\(0,12\).*hash.slice\(-8\)/s);
});
