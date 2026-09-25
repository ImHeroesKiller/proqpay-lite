import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Reports P1: payroll report endpoints are paginated and register excludes non-included lines',async()=>{
  const api=await read('functions/api/payroll-reports.js');
  assert.match(api,/const offset = Math\.max\(0,/);
  assert.match(api,/const limit = Math\.min\(500,/);
  assert.match(api,/LIMIT \? OFFSET \?/);
  assert.match(api,/nextOffset: truncated \? offset \+ limit : null/);
  assert.match(api,/WHERE \$\{where\} AND l\.included=1/);
  assert.doesNotMatch(api,/LIMIT 10000/);
  assert.doesNotMatch(api,/LIMIT 5000/);
  assert.doesNotMatch(api,/LIMIT 2000/);
});

test('Reports P1: payment reports expose settlement conflict instead of manual-proof precedence',async()=>{
  const source=await read('functions/api/operating-model-d1.js');
  const start=source.indexOf("if (resource === 'payment-reports')");
  const end=source.indexOf('const dashboardPeriodSql',start);
  assert.ok(start>=0&&end>start);
  const block=source.slice(start,end);
  assert.match(block,/manual_proof_total/);
  assert.match(block,/gateway_total/);
  assert.match(block,/THEN 'CONFLICT'/);
  assert.match(block,/END AS settlement_source/);
  assert.match(block,/THEN NULL[\s\S]*END AS paid_total/);
  assert.match(block,/paymentReportsMeta/);
  assert.match(block,/LIMIT \? OFFSET \?/);
  assert.doesNotMatch(block,/NULLIF\(\(SELECT SUM\(pp\.amount\)/);
});

test('Reports P1: ReportsWorkspace aggregates every backend page before KPI filtering and export',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  assert.match(source,/async function loadAllPayrollReport/);
  assert.match(source,/payload\?\.meta\?\.nextOffset/);
  assert.match(source,/async function loadAllPaymentReports/);
  assert.match(source,/payload\?\.paymentReportsMeta\?\.nextOffset/);
  assert.match(source,/settlementConflicts/);
  assert.match(source,/SETTLEMENT_CONFLICT/);
  assert.match(source,/settlement_source:row\.settlement_source/);
  assert.match(source,/manual_proof_total:row\.manual_proof_total/);
  assert.match(source,/gateway_total:row\.gateway_total/);
});

test('Reports P1: client Documents aggregates all invoice pages for table and KPI totals',async()=>{
  const source=await read('src/components/ClientDocumentsWorkspace.tsx');
  assert.match(source,/async function loadAllInvoices/);
  assert.match(source,/invoiceOffset:String\(offset\)/);
  assert.match(source,/body\?\.meta\?\.invoices\?\.nextOffset/);
  assert.match(source,/setInvoices\(await loadAllInvoices\(\)\)/);
});

test('Reports P1: latest reconciliation is deterministic in payment and control reports',async()=>{
  const payroll=await read('functions/api/payroll-reports.js');
  const operating=await read('functions/api/operating-model-d1.js');
  assert.match(payroll,/ORDER BY r\.created_at DESC,r\.id DESC LIMIT 1/);
  const start=operating.indexOf("if (resource === 'payment-reports')");
  const end=operating.indexOf('const dashboardPeriodSql',start);
  const block=operating.slice(start,end);
  assert.match(block,/ORDER BY r\.created_at DESC,r\.id DESC LIMIT 1/);
});
