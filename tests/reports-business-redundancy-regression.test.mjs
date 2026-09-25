import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Reports business audit: generic summaries use report-specific operational meaning',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  assert.match(source,/function GenericSummary/);
  assert.match(source,/Batch upload/);
  assert.match(source,/Baris diterima/);
  assert.match(source,/Slip tersedia/);
  assert.match(source,/Rekonsiliasi sesuai/);
  assert.match(source,/Masih terbuka/);
  assert.doesNotMatch(source,/Baris ditampilkan/);
});

test('Reports business audit: payment CSV separates payment and reconciliation differences',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  assert.match(source,/payment_difference:paymentDifference\(row\)/);
  assert.match(source,/reconciliation_difference:row\.difference/);
  assert.doesNotMatch(source,/[,{]difference:row\.difference/);
});

test('Reports maintainability audit: tab changes reset filters in one event path instead of a type-reset effect',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  assert.match(source,/function changeType\(next:ReportType\)/);
  assert.match(source,/onClick=\{\(\)=>changeType\(item\)\}/);
  assert.doesNotMatch(source,/useEffect\(\(\) => \{ setPage\(1\); setQuery\(''\); setStatus\('ALL'\); setPeriod\('ALL'\); \}, \[type\]\)/);
});

test('Client Documents audit: invoice table and mobile cards share bounded pagination',async()=>{
  const source=await read('src/components/ClientDocumentsWorkspace.tsx');
  assert.match(source,/const invoicePageSize=10/);
  assert.match(source,/const visibleInvoices=invoices\.slice/);
  assert.ok((source.match(/visibleInvoices\.map/g)||[]).length>=2);
  assert.match(source,/PanelPagination/);
});

test('Payroll redundancy audit: obsolete upload surface and endpoint are removed, Data Intake remains canonical',async()=>{
  const intake=await read('src/app/data-intake/page.tsx');
  assert.match(intake,/fetch\("\/api\/payroll-intake"/);
  await assert.rejects(()=>read('src/components/PayrollSourceUpload.tsx'),/ENOENT/);
  await assert.rejects(()=>read('functions/api/payroll-upload.js'),/ENOENT/);
  const validation=await read('functions/api/payroll-upload-validation.js');
  assert.match(validation,/validatePayrollControlRows/);
});
