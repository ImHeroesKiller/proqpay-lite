import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Reports P2: payroll reports expose stable facets independent of active filters',async()=>{
  const source=await read('functions/api/payroll-reports.js');
  assert.match(source,/const scopeWhere = scopeClauses\.join\(' AND '\)/);
  assert.match(source,/const facets = \{ periods, statuses: \[\] \}/);
  assert.match(source,/SELECT DISTINCT s\.period FROM payroll_submissions s/);
  assert.match(source,/facets\.statuses=/);
  assert.match(source,/params\.get\('status'\)/);
  assert.match(source,/params\.get\('q'\)/);
});

test('Reports P2: payment report supports aggregate client scope and server filters without clientId loop',async()=>{
  const backend=await read('functions/api/operating-model-d1.js');
  const frontend=await read('src/components/ReportsWorkspace.tsx');
  assert.match(backend,/const reportAggregate = resource === 'payment-reports'/);
  assert.match(backend,/clientIds:aggregateClientIds/);
  assert.match(backend,/paymentReportFacets/);
  assert.match(backend,/params\.get\('q'\)/);
  assert.match(backend,/params\.get\('status'\)/);
  assert.match(backend,/COALESCE\(s\.payment_period,s\.period\)=\?/);
  assert.doesNotMatch(frontend,/\/api\/me/);
  assert.doesNotMatch(frontend,/for\(const clientId of clientIds\)/);
});

test('Reports P2: UI uses server filters and stable facets instead of self-collapsing options',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  assert.match(source,/useDeferredValue\(query\.trim\(\)\)/);
  assert.match(source,/setFacets\(result\.facets\)/);
  assert.match(source,/const periods = facets\.periods/);
  assert.match(source,/const statusOptions = facets\.statuses/);
  assert.match(source,/params\.set\('period',filters\.period\)/);
  assert.match(source,/params\.set\('status',filters\.status\)/);
  assert.match(source,/params\.set\('q',filters\.query\)/);
  assert.doesNotMatch(source,/const statusOptions = \[\.\.\.new Set\(activeRows/);
});

test('Reports P2: report errors have visible retry behavior',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  assert.match(source,/className="card report-error"/);
  assert.match(source,/Coba lagi/);
  assert.match(source,/onClick=\{\(\)=>void load\(\)\}/);
});

test('Reports P2: payment and generic reports expose mobile card representations',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  const css=await read('src/app/polish.css');
  assert.ok((source.match(/report-mobile-list/g)||[]).length>=2);
  assert.ok((source.match(/report-mobile-card/g)||[]).length>=2);
  assert.match(css,/\.report-mobile-list \{\s*display:none;/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.report-desktop-table \{[\s\S]*display:none;/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.report-mobile-list \{[\s\S]*display:grid;/);
});

test('Reports P2: report type navigation no longer relies on inline layout styles',async()=>{
  const source=await read('src/components/ReportsWorkspace.tsx');
  const css=await read('src/app/polish.css');
  assert.match(source,/className="report-type-tabs"/);
  assert.match(css,/\.report-type-tabs/);
  assert.doesNotMatch(source,/style=\{\{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14\}\}/);
});
