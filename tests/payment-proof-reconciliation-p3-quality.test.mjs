import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  paymentEvidenceCoverage,
  paymentProofFileLabel,
  reconciliationControl,
  settlementSourceLabel,
  shortEvidenceFingerprint,
} from '../src/lib/payment-instruction-ui.ts';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('P3 payment evidence helpers centralize coverage and file presentation',()=>{
  assert.deepEqual(paymentEvidenceCoverage(1000,750),{
    expected:1000,evidence:750,remaining:250,percent:75,complete:false,over:false,
  });
  assert.equal(paymentEvidenceCoverage(1000,1000).complete,true);
  assert.equal(paymentProofFileLabel('application/pdf'),'PDF');
  assert.equal(paymentProofFileLabel('image/jpeg'),'JPEG');
  assert.equal(shortEvidenceFingerprint('1234567890abcdef1234567890abcdef'),'1234567890…abcdef');
});

test('P3 reconciliation helper exposes business control equation',()=>{
  const control=reconciliationControl({
    id:'RCA-1',
    expected_total:1000,
    instruction_total:1000,
    settlement_total:1000,
    difference:0,
    settlement_source:'MANUAL_PROOF',
    status:'MATCHED',
    reviewed_by:'controller@proqpay.test',
    created_at:'2026-09-24T12:00:00Z',
  });
  assert.equal(control?.matched,true);
  assert.equal(control?.settlementTotal,1000);
  assert.equal(settlementSourceLabel('MANUAL_PROOF'),'Manual payment evidence');
  assert.equal(settlementSourceLabel('PAYMENT_GATEWAY'),'Payment gateway');
});

test('P3 extracts payment evidence and reconciliation panels from workspace',async()=>{
  const workspace=await read('src/components/OperatingWorkspace.tsx');
  const panel=await read('src/components/PaymentEvidenceReconciliation.tsx');
  assert.match(workspace,/PaymentEvidenceRegister/);
  assert.match(workspace,/PaymentReconciliationControl/);
  assert.match(panel,/RECONCILIATION CONTROL/);
  assert.match(panel,/Expected PI/);
  assert.match(panel,/Settlement source/);
  assert.match(panel,/Payment Evidence Register/);
  assert.match(panel,/shortEvidenceFingerprint/);
});

test('P3 operational proof copy hides infrastructure implementation details',async()=>{
  const proof=await read('functions/api/payment-proof.js');
  const workspace=await read('src/components/OperatingWorkspace.tsx');
  assert.match(proof,/PAYMENT_PROOF_STORAGE_UNAVAILABLE/);
  assert.match(proof,/PAYMENT_DATA_UNAVAILABLE/);
  assert.doesNotMatch(proof,/Tambahkan R2 binding FILES di Cloudflare Pages/);
  assert.doesNotMatch(proof,/Cloudflare D1 belum terhubung/);
  assert.doesNotMatch(workspace,/tersimpan private di R2/);
  assert.doesNotMatch(workspace,/Bukti pembayaran tersimpan di R2/);
});
