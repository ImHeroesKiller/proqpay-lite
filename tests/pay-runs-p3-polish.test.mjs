import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Pay Runs P3 adds operational summary and stage grouping',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/pay-run-p3-summary/);
  assert.match(ui,/Action required/);
  assert.match(ui,/Ready \/ payment/);
  assert.match(ui,/pay-run-group-tabs/);
  assert.match(ui,/runGroup/);
  assert.match(ui,/BLOCKED/);
});

test('Pay Runs P3 uses business-friendly source and run-type labels',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/function payRunSourceLabel/);
  assert.match(ui,/Current master/);
  assert.match(ui,/Previous payroll/);
  assert.match(ui,/Data Intake snapshot/);
  assert.match(ui,/function payRunTypeLabel/);
  assert.match(ui,/Regular payroll/);
  assert.match(ui,/Adjustment/);
});

test('Pay Runs P3 adds responsive mobile payroll cards',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  const css=await read('src/app/polish.css');
  assert.match(ui,/pay-run-mobile-list/);
  assert.match(ui,/pay-run-mobile-card/);
  assert.match(ui,/pay-run-mobile-metrics/);
  assert.match(css,/\.pay-run-desktop-list \{ display:none; \}/);
  assert.match(css,/\.pay-run-mobile-list \{ display:grid/);
});

test('Pay Runs P3 strengthens review hierarchy and Adjustment parent context',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/pay-run-review-hero/);
  assert.match(ui,/Current stage/);
  assert.match(ui,/pay-run-parent-context/);
  assert.match(ui,/ADJUSTMENT LINK/);
  assert.match(ui,/parent_submission_id/);
});

test('Pay Runs P3 adds contextual grouped empty state',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/Tidak ada Pay Run pada kelompok ini/);
  assert.match(ui,/Tampilkan semua/);
  assert.match(ui,/Belum ada Pay Run pada scope ini/);
});

test('Pay Runs P3 preserves P1 and P2 hardening controls',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(ui,/pay-run-edit-modal/);
  assert.match(ui,/pay-run-action-composer/);
  assert.match(api,/PAY_RUN_LINE_CHANGED/);
  assert.match(api,/PAYMENT_TERMS_LOCKED_AFTER_REVIEW/);
  assert.match(api,/PAY_RUN_POPULATION_RECONCILED/);
});

test('Pay Runs P3 styling covers summary tabs review hero and mobile cards',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Pay Runs P3/);
  assert.match(css,/\.pay-run-p3-summary/);
  assert.match(css,/\.pay-run-group-tabs/);
  assert.match(css,/\.pay-run-review-hero/);
  assert.match(css,/\.pay-run-parent-context/);
});
