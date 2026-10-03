import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('P3 reduces internal KPI noise into three decision metrics',async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/operations-summary-decision/);
  assert.match(source,/Needs decision/);
  assert.match(source,/Ready to pay/);
  assert.match(source,/Needs reconcile/);
});

test('P3 gives Controller a decision control before technical PI detail',async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/pi-decision-summary/);
  assert.match(source,/DECISION CONTROL/);
  assert.match(source,/Snapshot integrity/);
  assert.match(source,/Provider routing/);
  assert.match(source,/Liquidity/);
});

test('P3 keeps the PI footer focused and moves bank exports behind disclosure',async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/controller-decision/);
  assert.match(source,/pi-export-more/);
  assert.match(source,/Bank file/);
  assert.match(source,/Kontrol utama PI sudah saya review/);
});

test('P3 provides retryable error state and non-jumping loading skeleton',async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/Coba lagi/);
  assert.match(source,/WorkspaceLoading/);
  assert.match(source,/workspace-loading-skeleton/);
});

test('P3 makes workspace copy role-aware and mobile stage navigation compact',async()=>{
  const [workspace,css]=await Promise.all([
    read('src/components/UnifiedPayrollWorkspace.tsx'),
    read('src/app/globals.css'),
  ]);
  assert.match(workspace,/isController\?'Selesaikan keputusan payroll/);
  assert.match(css,/payroll-stage-nav\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/operations-summary-decision\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
