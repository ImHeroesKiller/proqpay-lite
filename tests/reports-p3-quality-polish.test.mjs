import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Reports P3: typed UI contracts replace any-based report workspace state',async()=>{
  const workspace=await read('src/components/ReportsWorkspace.tsx');
  const ui=await read('src/lib/report-ui.ts');
  assert.match(ui,/export type ReportRow/);
  assert.match(ui,/export type PaymentReport/);
  assert.match(ui,/export type ReportFacets/);
  assert.match(ui,/export type ReportType/);
  assert.doesNotMatch(workspace,/\bany\b/);
  assert.match(workspace,/type ReportRow/);
  assert.match(workspace,/type PaymentReport/);
});

test('Reports P3: report columns and statuses use canonical human-readable labels',async()=>{
  const workspace=await read('src/components/ReportsWorkspace.tsx');
  const ui=await read('src/lib/report-ui.ts');
  assert.match(ui,/const COLUMN_LABELS/);
  assert.match(ui,/const STATUS_LABELS/);
  assert.match(ui,/reportColumnLabel/);
  assert.match(ui,/reportStatusLabel/);
  assert.match(ui,/reportStatusTone/);
  assert.match(workspace,/reportColumnLabel\(key\)/);
  assert.match(workspace,/reportStatusLabel\(/);
  assert.doesNotMatch(workspace,/>\{key\.replaceAll\('_',' '\)\}<\/th>/);
});

test('Reports P3: operational copy is normalized for Indonesian users',async()=>{
  const workspace=await read('src/components/ReportsWorkspace.tsx');
  const ui=await read('src/lib/report-ui.ts');
  assert.match(ui,/Laporan Pembayaran/);
  assert.match(ui,/Register Payroll/);
  assert.match(workspace,/Laporan Payroll & Pembayaran/);
  assert.match(workspace,/Riwayat Pembayaran/);
  assert.match(workspace,/Cari karyawan, klien, project, batch, pay run/);
});

test('Reports P3: desktop report tables use bounded scroll and sticky dense headers',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Reports UI — consolidated final layout/);
  assert.match(css,/\.report-table-wrap \{[\s\S]*max-height:min\(64vh,760px\)[\s\S]*overflow:auto !important/);
  assert.match(css,/\.report-table th \{[\s\S]*position:sticky[\s\S]*top:0/);
  assert.match(css,/\.report-table td \{[\s\S]*padding:10px 11px !important/);
});

test('Reports P3: final report polish is consolidated and retains mobile cards',async()=>{
  const css=await read('src/app/polish.css');
  assert.equal((css.match(/Reports UI — consolidated final layout/g)||[]).length,1);
  assert.doesNotMatch(css,/Reports P2 — operational UX hardening/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.report-desktop-table \{[\s\S]*display:none/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.report-mobile-list \{[\s\S]*display:grid/);
  assert.match(css,/\.report-status-neutral/);
});

test('Reports P3: generic mobile cards use shared title and column helpers',async()=>{
  const workspace=await read('src/components/ReportsWorkspace.tsx');
  assert.match(workspace,/reportPrimaryTitle\(row\)/);
  assert.match(workspace,/reportSecondaryTitle\(row\)/);
  assert.match(workspace,/reportColumnLabel\(key\)/);
  assert.match(workspace,/reportStatusTone\(row\.status\|\|row\.state\|\|row\.payment_status\)/);
});
