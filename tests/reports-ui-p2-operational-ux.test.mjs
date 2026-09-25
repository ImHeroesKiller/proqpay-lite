import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Reports P2 UX: report types expose semantic tabs',async()=>{
  const reports=await read('src/components/ReportsWorkspace.tsx');
  assert.match(reports,/role="tablist"/);
  assert.match(reports,/role="tab"/);
  assert.match(reports,/aria-selected=\{type===item\}/);
});

test('Reports P2 UX: KPI cards provide operational context and semantic tone',async()=>{
  const reports=await read('src/components/ReportsWorkspace.tsx');
  const css=await read('src/app/polish.css');
  assert.match(reports,/Settlement selesai tanpa konflik sumber/);
  assert.match(reports,/Exception, bukti pending, atau konflik settlement/);
  assert.match(reports,/tone=\{paymentFollowUp\?'warning':'success'\}/);
  assert.match(css,/report-summary-warning/);
  assert.match(css,/report-summary-success/);
});

test('Reports P2 UX: pagination exposes visible range and first-last navigation',async()=>{
  const pagination=await read('src/components/PanelPagination.tsx');
  const reports=await read('src/components/ReportsWorkspace.tsx');
  assert.match(pagination,/\{start\}–\{end\} dari \{total\}/);
  assert.match(pagination,/Halaman pertama/);
  assert.match(pagination,/Halaman terakhir/);
  assert.match(reports,/pageSize=\{pageSize\}/);
});

test('Reports P2 UX: filter sticky spacing and mobile pagination are hardened',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/\.report-filter \{\s*top:8px;/);
  assert.match(css,/\.dashboard-list-pagination \{[\s\S]*justify-content:space-between/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.dashboard-list-pagination[\s\S]*flex-direction:column/);
});
