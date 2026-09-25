import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employees UI P2: toolbar uses compact search + explicit filter panel and reset',async()=>{
  const source=await read('src/components/EmployeeDirectory.tsx');
  assert.match(source,/employee-toolbar-main/);
  assert.match(source,/employee-filter-actions/);
  assert.match(source,/aria-expanded={filtersOpen}/);
  assert.match(source,/employee-filter-panel/);
  assert.match(source,/function resetFilters/);
  assert.match(source,/activeFilterCount/);
});

test('Employees UI P2: desktop table has stable columns and bounded vertical scroll with sticky header',async()=>{
  const directory=await read('src/components/EmployeeDirectory.tsx');
  const css=await read('src/app/polish.css');
  assert.match(directory,/<colgroup>/);
  assert.match(directory,/employee-col-person/);
  assert.match(directory,/employee-col-salary/);
  assert.match(css,/\.employee-table-scroll \{[\s\S]*max-height:min\(62vh,720px\)/);
  assert.match(css,/\.employee-table \{[\s\S]*table-layout:fixed/);
  assert.match(css,/\.employee-table th \{[\s\S]*position:sticky/);
});

test('Employees UI P2: ESS credential summary exposes loading, error and retry states',async()=>{
  const source=await read('src/components/EmployeeCredentialsPanel.tsx');
  assert.match(source,/const \[loading, setLoading\]/);
  assert.match(source,/async function loadSummary/);
  assert.match(source,/if \(!response\.ok \|\| !data\?\.ok\)/);
  assert.match(source,/employee-ess-error/);
  assert.match(source,/Coba lagi/);
  assert.match(source,/disabled=\{busy \|\| loading \|\| summary == null \|\| summary\.pending === 0\}/);
});

test('Employees UI P2: drawer protects dirty admin edits from close, backdrop, Escape and cancel',async()=>{
  const source=await read('src/components/EmployeeDetailDrawer.tsx');
  assert.match(source,/const dirty=editing && JSON\.stringify\(form\)!==JSON\.stringify\(initialForm\)/);
  assert.match(source,/function requestClose\(\)/);
  assert.match(source,/setDiscardConfirm\(true\)/);
  assert.match(source,/onMouseDown=\{\(event\)=>\{if\(event\.target===event\.currentTarget\)requestClose\(\);\}\}/);
  assert.match(source,/onClick=\{requestClose\}/);
  assert.match(source,/Perubahan belum disimpan/);
  assert.match(source,/Buang perubahan/);
});
