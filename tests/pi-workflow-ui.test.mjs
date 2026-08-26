import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const ui = readFileSync('src/components/OperatingWorkspace.tsx', 'utf8');

test('Processor sees submit and rejected PI recovery actions', () => {
  assert.match(ui, /PAYMENT_INSTRUCTION_READY[\s\S]*?Submit PI/);
  assert.match(ui, /REVISION_REQUIRED[\s\S]*?Perbaiki data PI/);
  assert.match(ui, /Unduh template koreksi/);
  assert.match(ui, /APPLY_BANK_CORRECTIONS/);
  assert.match(ui, /Alasan reject:/);
  assert.match(ui, /Revisi \$\{Number\(r\.revision_no\)-1\}/);
  assert.match(ui, /OPEN_PAYMENT_REVIEW/);
  assert.match(ui, /Mulai review/);
  assert.match(ui, /rejection_reason/);
});

test('Controller role fallback keeps approve action visible', () => {
  assert.match(ui, /const canApprovePayment = isController \|\|/);
  assert.match(ui, /Preview & Approve/);
});

test('Payment Control filters PI status and preserves rejected PI reasons', () => {
  assert.match(ui, /mode === 'payments' \? 'Status PI' : 'Status pay run'/);
  assert.match(ui, /statusMatches = statusFilter === 'ALL' \|\| row\.status === statusFilter/);
  assert.match(ui, /r\.rejection_reason\?<small/);
});

test('Controller can approve or return CONTROLLER_REVIEW pay run', () => {
  assert.match(ui, /PAYROLL_CONTROLLER[\s\S]*?CONTROLLER_REVIEW[\s\S]*?DATA_APPROVED/);
  assert.match(ui, /CONTROLLER_REVIEW:'Setujui Data Payroll'/);
  assert.match(ui, /toState:'REVISION_REQUIRED'/);
  assert.match(ui, /Minta revisi/);
  assert.match(ui, /DATA_APPROVED[\s\S]*?PAYMENT_INSTRUCTION_READY/);
  assert.match(ui, /reviewConfirmed:true/);
});
