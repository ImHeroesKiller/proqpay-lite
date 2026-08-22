import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const ui = readFileSync('src/components/OperatingWorkspace.tsx', 'utf8');

test('Processor sees submit and rejected PI recovery actions', () => {
  assert.match(ui, /PAYMENT_INSTRUCTION_READY[\s\S]*?Submit PI/);
  assert.match(ui, /REVISION_REQUIRED[\s\S]*?Perbaiki Pay Run/);
  assert.match(ui, /rejection_reason/);
});

test('Controller role fallback keeps approve action visible', () => {
  assert.match(ui, /const canApprovePayment = isController \|\|/);
  assert.match(ui, /Preview & Approve/);
});
