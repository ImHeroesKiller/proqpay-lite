import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const api = readFileSync('functions/api/reset-pay-run-workflow.js','utf8');
const page = readFileSync('src/app/recovery/page.tsx','utf8');

test('recovery is limited to controller and super admin',()=>{
  assert.match(api,/const ROLES = \['SUPER_ADMIN', 'PAYROLL_CONTROLLER'\]/);
});

test('recovery blocks downstream financial artifacts',()=>{
  assert.match(api,/payment_proofs/);
  assert.match(api,/reconciliations/);
  assert.match(api,/invoices/);
  assert.match(api,/PAY_RUN_RESET_BLOCKED/);
});

test('recovery preserves payroll snapshot and only rejects early PI',()=>{
  assert.doesNotMatch(api,/DELETE FROM payroll_run_lines/i);
  assert.doesNotMatch(api,/DELETE FROM payment_instruction_lines/i);
  assert.match(api,/SET status='REJECTED'/);
  assert.match(api,/SET state='CONTROLLER_REVIEW'/);
  assert.match(api,/PAY_RUN_WORKFLOW_RESET/);
});

test('recovery requires explicit confirmation and reason',()=>{
  assert.match(api,/RESET PAY RUN WORKFLOW/);
  assert.match(api,/Alasan reset wajib 10-500 karakter/);
  assert.match(page,/Reset Pay Run Workflow/);
});
