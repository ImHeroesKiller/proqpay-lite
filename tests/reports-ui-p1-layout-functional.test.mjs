import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Reports UI P1: Reports stays read-only while Data Intake owns payroll file ingestion',async()=>{
  const reports=await read('src/components/ReportsWorkspace.tsx');
  const intake=await read('src/app/data-intake/page.tsx');
  assert.doesNotMatch(reports,/type="file"/);
  assert.match(intake,/Data Intake Payroll/);
  assert.match(intake,/Unggah & validasi/);
});

test('Reports UI P1: filters have labels, reset behavior and accessible empty recovery',async()=>{
  const reports=await read('src/components/ReportsWorkspace.tsx');
  assert.match(reports,/>Cari<\/span>/);
  assert.match(reports,/>Periode<\/span>/);
  assert.match(reports,/>Status<\/span>/);
  assert.match(reports,/function resetFilters/);
  assert.match(reports,/Reset filter/);
});

test('Reports UI P1: audit tables use sticky identity and numeric alignment',async()=>{
  const reports=await read('src/components/ReportsWorkspace.tsx');
  const css=await read('src/app/polish.css');
  assert.match(reports,/report-sticky-col/);
  assert.match(reports,/report-num/);
  assert.match(css,/\.report-table \.report-sticky-col/);
  assert.match(css,/\.report-table \.report-num/);
  assert.match(css,/\.report-type-control \{ min-width:1540px; \}/);
});

test('Reports UI P1: mobile report cards preserve report-specific fields and expandable details',async()=>{
  const reports=await read('src/components/ReportsWorkspace.tsx');
  const css=await read('src/app/polish.css');
  assert.match(reports,/reportMobileFields\(type,columns\)/);
  assert.match(reports,/Lihat detail pembayaran/);
  assert.match(reports,/Lihat detail laporan/);
  assert.match(css,/\.report-mobile-details/);
  assert.match(css,/\.report-mobile-grid strong \{[\s\S]*font-size:12px/);
});

test('Reports UI P1: client documents hierarchy does not duplicate the embedded report heading',async()=>{
  const client=await read('src/components/ClientDocumentsWorkspace.tsx');
  const reports=await read('src/components/ReportsWorkspace.tsx');
  assert.match(client,/Dokumen & Laporan/);
  assert.match(client,/Laporan Payroll & Pembayaran/);
  assert.match(client,/ReportsWorkspace clientMode hideHeading/);
  assert.match(reports,/hideHeading/);
});
