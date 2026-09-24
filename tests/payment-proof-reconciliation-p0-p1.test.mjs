import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  detectPaymentProofType,
  validPaymentProofDate,
  validatePaymentProofContent,
} from '../functions/api/payment-proof-validation.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Payment Proof P0 enforces both client and project scope on direct download',async()=>{
  const source=await read('functions/api/payment-proof.js');
  assert.match(source,/JOIN payroll_submissions s ON s\.id=pi\.submission_id/);
  assert.match(source,/s\.project_id/);
  assert.match(source,/canAccessProject\(authorization\.actor, proof\.project_id\)/);
});

test('Payment Proof P1 only lets maker record manual evidence and checker reconcile',async()=>{
  const proof=await read('functions/api/payment-proof.js');
  const edge=await read('functions/api/operating-model.js');
  const d1=await read('functions/api/operating-model-d1.js');
  const ui=await read('src/components/OperatingWorkspace.tsx');

  assert.match(proof,/WRITE_ROLES = \['SUPER_ADMIN','PAYROLL_PROCESSOR'\]/);
  assert.match(proof,/PAYMENT_PROOF_WRITE_PERMISSION_REQUIRED/);
  assert.match(edge,/PAYMENT_RECONCILE_PERMISSION_REQUIRED/);
  assert.match(edge,/reconciliation:write/);
  assert.match(d1,/PAYMENT_RECONCILE_PERMISSION_REQUIRED/);
  assert.match(d1,/CONTROLLER_ROLES\.has\(actor\.role\)/);
  assert.match(ui,/canRecordProof=\{isProcessor\}/);
  assert.match(ui,/canReconcile=\{isController/);
});

test('Payment Proof P1 validates real calendar dates',()=>{
  assert.equal(validPaymentProofDate('2026-09-24'),true);
  assert.equal(validPaymentProofDate('2026-02-29'),false);
  assert.equal(validPaymentProofDate('2024-02-29'),true);
  assert.equal(validPaymentProofDate('2026-13-01'),false);
  assert.equal(validPaymentProofDate('2026-00-12'),false);
  assert.equal(validPaymentProofDate('not-a-date'),false);
});

test('Payment Proof P1 validates PDF JPEG and PNG signatures',()=>{
  assert.equal(detectPaymentProofType(new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31])),'application/pdf');
  assert.equal(detectPaymentProofType(new Uint8Array([0xff,0xd8,0xff,0xe0])),'image/jpeg');
  assert.equal(detectPaymentProofType(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),'image/png');
  assert.equal(detectPaymentProofType(new Uint8Array([1,2,3,4])),'');
  assert.equal(validatePaymentProofContent({type:'application/pdf'},new Uint8Array([0xff,0xd8,0xff])).ok,false);
});

test('Payment Proof P1 keeps partial manual evidence out of reconciliation-ready state',async()=>{
  const proof=await read('functions/api/payment-proof.js');
  const edge=await read('functions/api/operating-model.js');
  const d1=await read('functions/api/operating-model-d1.js');

  assert.match(proof,/const evidenceComplete = nextProofTotal === Number\(payment\.expected_total \|\| 0\)/);
  assert.match(proof,/CASE WHEN \?=1 THEN 'PROOF_UPLOADED' ELSE status END/);
  assert.match(edge,/RECONCILIATION_EVIDENCE_INCOMPLETE/);
  assert.match(d1,/RECONCILIATION_EVIDENCE_INCOMPLETE/);
});

test('Payment Proof replay remains idempotent after evidence reaches expected total',async()=>{
  const source=await read('functions/api/payment-proof.js');
  const existingAt=source.indexOf('const existing = await d1First');
  const totalAt=source.indexOf('const currentProofTotal = await d1First');
  assert.ok(existingAt>0 && totalAt>existingAt,'duplicate replay must be checked before cumulative-total rejection');
});
