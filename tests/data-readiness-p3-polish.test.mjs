import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Data Readiness P3 exposes operational readiness KPIs',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/Critical blocker/);
  assert.match(ui,/Warning/);
  assert.match(ui,/Client action/);
  assert.match(ui,/Ready \/ clean/);
  assert.match(ui,/cleanRuns/);
  assert.match(ui,/resolvedExceptions/);
});

test('Data Readiness P3 adds grouped readiness navigation',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/readiness-group-tabs/);
  assert.match(ui,/Blocker/);
  assert.match(ui,/Internal action/);
  assert.match(ui,/Resolved/);
  assert.match(ui,/groupMatches/);
});

test('Data Readiness P3 uses business-friendly severity and status labels',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/readinessSeverityLabel/);
  assert.match(ui,/readinessStatusLabel/);
  assert.match(ui,/Blocker/);
  assert.match(ui,/Client confirmed/);
  assert.match(ui,/readiness-pill/);
});

test('Data Readiness P3 adds mobile cards and contextual empty states',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  const css=await read('src/app/polish.css');
  assert.match(ui,/readiness-mobile-list/);
  assert.match(ui,/readiness-mobile-card/);
  assert.match(ui,/Data readiness bersih/);
  assert.match(ui,/Belum ada Pay Run untuk direview/);
  assert.match(ui,/Tidak ada temuan sesuai filter/);
  assert.match(css,/\.readiness-desktop-table \{ display:none; \}/);
  assert.match(css,/\.readiness-mobile-list \{ display:grid/);
});

test('Data Readiness P3 strengthens decision panel with affected Pay Run summary',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/READINESS DECISION/);
  assert.match(ui,/readiness-decision-hero/);
  assert.match(ui,/AFFECTED PAY RUN/);
  assert.match(ui,/readiness-payrun-summary/);
  assert.match(ui,/Net payroll/);
  assert.match(ui,/Headcount/);
});

test('Data Readiness P3 preserves P1 evidence decision and P2 timeline/composer',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/readiness-evidence-panel/);
  assert.match(ui,/evidenceReviewed/);
  assert.match(ui,/readiness-timeline/);
  assert.match(ui,/readiness-message-composer/);
  assert.match(ui,/resolutionNote\.trim\(\)\.length<10/);
});

test('Data Readiness P3 styles grouped filters, semantic pills and responsive decision views',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Data Readiness P3/);
  assert.match(css,/\.readiness-group-tabs/);
  assert.match(css,/\.readiness-pill\.severity-critical/);
  assert.match(css,/\.readiness-pill\.status-client-action-required/);
  assert.match(css,/\.readiness-decision-hero/);
  assert.match(css,/\.readiness-payrun-summary/);
});
