import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Reports P3 quality: mobile and status display contracts live in report-ui',async()=>{
  const workspace=await read('src/components/ReportsWorkspace.tsx');
  const ui=await read('src/lib/report-ui.ts');
  assert.match(ui,/export const REPORT_MOBILE_FIELDS/);
  assert.match(ui,/export function isReportStatusColumn/);
  assert.match(ui,/export function reportMobileFields/);
  assert.doesNotMatch(workspace,/const MOBILE_FIELDS/);
  assert.match(workspace,/reportMobileFields\(type,columns\)/);
  assert.match(workspace,/isReportStatusColumn\(key\)/);
});

test('Reports P3 quality: export and loading surfaces use reusable visual components',async()=>{
  const workspace=await read('src/components/ReportsWorkspace.tsx');
  const icons=await read('src/components/Icons.tsx');
  const css=await read('src/app/polish.css');
  assert.match(icons,/export function IconDownload/);
  assert.match(workspace,/IconDownload aria-hidden="true"/);
  assert.match(workspace,/report-loading-bar/);
  assert.match(css,/report-loading-shimmer/);
  assert.match(css,/prefers-reduced-motion: reduce/);
});

test('Reports P3 maintainability: client document invoices are typed and responsive',async()=>{
  const client=await read('src/components/ClientDocumentsWorkspace.tsx');
  const css=await read('src/app/polish.css');
  assert.match(client,/type ClientInvoice =/);
  assert.match(client,/useState<ClientInvoice\[\]>/);
  assert.doesNotMatch(client,/\bany\b/);
  assert.match(client,/client-invoice-mobile-list/);
  assert.match(css,/\.client-invoice-mobile-list/);
  assert.match(client,/IconRefresh aria-hidden="true"/);
});

test('Reports P3 visual polish: operational terms remain human readable',async()=>{
  const ui=await read('src/lib/report-ui.ts');
  assert.match(ui,/severity:'Tingkat'/);
  assert.match(ui,/reconciliation_difference:'Selisih Rekonsiliasi'/);
  assert.match(ui,/CLIENT_ACTION_REQUIRED:'Perlu Tindakan Klien'/);
});
