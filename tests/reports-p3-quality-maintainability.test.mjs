import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Reports P3: shared report UI module owns typed payload contracts and formatting semantics',async()=>{
  const source=await read('src/lib/report-ui.ts');
  assert.match(source,/export type PayrollReportResponse/);
  assert.match(source,/export type PaymentReportResponse/);
  assert.match(source,/export type ReportPageMeta/);
  assert.match(source,/export function reportFormatValue/);
  assert.match(source,/export function reportExportRecord/);
  assert.match(source,/export function isPayrollReportResponse/);
  assert.match(source,/export function isPaymentReportResponse/);
});

test('Reports P3: human readable labels cover exported payment fields',async()=>{
  const source=await read('src/lib/report-ui.ts');
  for(const field of ['payment_id','payroll_period','payment_period','settlement_source','manual_proof_total','gateway_total','paid_total','payment_date','payment_difference','reconciliation_difference']){
    assert.match(source,new RegExp(`${field}:'`));
  }
});

test('Reports P3: workspace uses typed response envelopes and shared formatting/export helpers',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  assert.match(source,/const payload:PayrollReportResponse=/);
  assert.match(source,/const payload:PaymentReportResponse=/);
  assert.match(source,/isPayrollReportResponse\(payload\)/);
  assert.match(source,/isPaymentReportResponse\(payload\)/);
  assert.match(source,/reportExportRecord\(row\)/);
  assert.match(source,/return reportFormatValue\(key,value\)/);
});

test('Reports P3: CSV export no longer exposes raw database column names as headers',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  assert.match(source,/rows\.map\(\(row\)=>reportExportRecord\(row\)\)/);
  assert.match(source,/filteredPayroll\.map\(\(row\)=>reportExportRecord/);
});

test('Reports P3: report CSS is consolidated into one final quality layer',async()=>{
  const css=await read('src/app/polish.css');
  assert.equal((css.match(/Reports UI — final consolidated quality layer/g)||[]).length,1);
  assert.doesNotMatch(css,/Reports P1 UI —/);
  assert.doesNotMatch(css,/Reports operational UX hardening/);
  assert.doesNotMatch(css,/Reports quality, polish and maintainability/);
  assert.match(css,/\.report-table {[\s\S]*font-variant-numeric:tabular-nums/);
  assert.match(css,/\.report-table \.report-sticky-col {[\s\S]*position:sticky/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.report-desktop-table \{[\s\S]*display:none/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.report-mobile-list,[\s\S]*\.client-invoice-mobile-list \{[\s\S]*display:grid/);
});

test('Reports P3: loading polish respects reduced motion',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/@keyframes report-loading-shimmer/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)[\s\S]*animation:none/);
});
