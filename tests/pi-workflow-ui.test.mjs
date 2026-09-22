import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const ui = readFileSync('src/components/OperatingWorkspace.tsx', 'utf8');
const nextAction = readFileSync('src/lib/payroll-next-action-core.js', 'utf8');

test('Processor sees submit and rejected PI recovery actions', () => {
  assert.match(ui, /PAYMENT_INSTRUCTION_READY[\s\S]*?Submit PI/);
  assert.match(ui, /REVISION_REQUIRED[\s\S]*?Perbaiki Pay Run/);
  assert.match(ui, /rejection_reason/);
});

test('Controller role fallback keeps approve action visible', () => {
  assert.match(ui, /const canApprovePayment = isController \|\|/);
  assert.match(ui, /Preview & Approve/);
});

test('Payment Control filters PI status and hides stale rejection reasons', () => {
  assert.match(ui, /mode === 'payments' \? 'Status PI'/);
  assert.match(ui, /statusMatches = statusFilter === 'ALL' \|\| row\.status === statusFilter/);
  assert.match(ui, /r\.status === 'REVISION_REQUIRED' && r\.rejection_reason/);
});

test('Controller can approve or return CONTROLLER_REVIEW pay run', () => {
  assert.match(nextAction, /state === 'CONTROLLER_REVIEW'/);
  assert.match(nextAction, /REVIEW_APPROVE_PAYROLL/);
  assert.match(nextAction, /workflowCommand:'DATA_APPROVED'/);
  assert.match(nextAction, /\['DATA_APPROVED','PAYROLL_FINALIZED'\]/);
  assert.match(nextAction, /workflowCommand:'PAYMENT_INSTRUCTION_READY'/);
  assert.match(ui, /toState:'REVISION_REQUIRED'/);
  assert.match(ui, /Minta revisi/);
  assert.match(ui, /const next=nextAction\.workflowCommand/);
  assert.match(ui, /reviewConfirmed:true/);
});
