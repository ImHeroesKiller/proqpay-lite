import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Pay Runs P2 replaces payroll line prompts with a controlled edit modal',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/pay-run-edit-modal/);
  assert.match(ui,/PAYROLL LINE EDIT/);
  assert.match(ui,/Alasan perubahan/);
  assert.match(ui,/Simpan perubahan/);
  const payRunLineBlock=ui.slice(ui.indexOf('function PayRunLineTable('),ui.indexOf('function Exceptions('));
  assert.doesNotMatch(payRunLineBlock,/window\.prompt/);
  assert.match(payRunLineBlock,/changeReason\.trim\(\)\.length>=10/);
});

test('Pay Runs P2 clamps client and internal payroll pagination',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  const matches=ui.match(/setPage\(\(current\)=>Math\.min\(current,pages\)\)/g)||[];
  assert.ok(matches.length>=2);
  assert.match(ui,/Math\.max\(1,value-1\)/);
  assert.match(ui,/Math\.min\(pages,value\+1\)/);
});

test('Pay Runs P2 filters Adjustment parents to valid finalized REGULAR runs',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/adjustmentParentStates/);
  assert.match(ui,/row\.run_type==='REGULAR'/);
  assert.match(ui,/row\.period<=form\.period/);
  assert.match(ui,/Adjustment terhubung ke payroll induk/);
});

test('Pay Runs P2 adds rich payroll variance diagnostics',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(api,/previous_account_last4/);
  assert.match(api,/grossAmount:currentGross-previousGross/);
  assert.match(api,/deductionAmount:currentDeduction-previousDeduction/);
  assert.match(api,/headcountAmount/);
  assert.match(api,/bankChangedEmployees/);
  assert.match(ui,/Δ Headcount/);
  assert.match(ui,/Δ Gross/);
  assert.match(ui,/Rekening berubah/);
});

test('Pay Runs P2 master refresh reconciles current population and emits audit summary',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(api,/PAY_RUN_REFRESH_PERMISSION_REQUIRED/);
  assert.match(api,/MASTER_CURRENT_REFRESH_NEW/);
  assert.match(api,/UPDATE payroll_run_lines SET included=0/);
  assert.match(api,/PAY_RUN_MASTER_REFRESHED/);
  assert.match(api,/before:\{recipients:/);
  assert.match(api,/after:\{recipients:/);
});

test('Pay Runs P2 uses inline controlled composers for destructive and revision actions',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  const submissions=ui.slice(ui.indexOf('function Submissions('),ui.indexOf('function ClientApprovalPreview('));
  assert.match(submissions,/pay-run-action-composer/);
  assert.match(submissions,/kind:'DELETE'/);
  assert.match(submissions,/kind:'REFRESH'/);
  assert.match(submissions,/kind:'REOPEN'/);
  assert.match(submissions,/kind:'CONTROLLER_REVISION'/);
  assert.match(submissions,/kind:'CLIENT_REVISION'/);
  assert.doesNotMatch(submissions,/window\.prompt|window\.confirm/);
});

test('Pay Runs P2 review modal supports Escape focus trap restore and scroll lock',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  const submissions=ui.slice(ui.indexOf('function Submissions('),ui.indexOf('function ClientApprovalPreview('));
  assert.match(submissions,/reviewDialogRef/);
  assert.match(submissions,/document\.body\.style\.overflow='hidden'/);
  assert.match(submissions,/event\.key==='Escape'/);
  assert.match(submissions,/event\.key!=='Tab'/);
  assert.match(submissions,/previousFocusRef\.current\?\.focus\(\)/);
});

test('Pay Runs P2 includes responsive styling for edit and action workflows',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Pay Runs P2/);
  assert.match(css,/\.pay-run-action-composer/);
  assert.match(css,/\.pay-run-edit-modal/);
  assert.match(css,/\.pay-run-delta/);
  assert.match(css,/\.pay-run-variance-rich/);
});
