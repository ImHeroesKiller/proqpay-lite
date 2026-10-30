import {readPolishCss} from './helpers/style-sources.mjs';
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
  const css=await readPolishCss();
  assert.match(directory,/<colgroup>/);
  assert.match(directory,/employee-col-person/);
  assert.match(directory,/employee-col-salary/);
  assert.match(css,/\.employee-table-scroll \{[\s\S]*max-height:min\(62vh,720px\)/);
  assert.match(css,/\.employee-table \{[\s\S]*table-layout:fixed/);
  assert.match(css,/\.employee-table th \{[\s\S]*position:sticky/);
});

test('Employees ESS generation preserves explicit confirmation, errors and pending state',async()=>{
 const source=await read('src/components/EmployeeDetailDrawer.tsx');
 assert.match(source,/Generate password ESS\?/);
 assert.match(source,/setResetting\(true\)/);
 assert.match(source,/parseApiResponse/);
 assert.match(source,/employee-profile-error/);
 assert.match(source,/if\(!result.employee\?\.password\)throw new Error/);
 assert.match(source,/disabled=\{saving\|\|resetting\|\|dirty\|\|essState==='INACTIVE'\}/);
});

test('Employees UI P2: drawer protects dirty admin edits from close, backdrop, Escape and cancel',async()=>{
  const source=await read('src/components/EmployeeDetailDrawer.tsx');
  assert.match(source,/const dirty=editing && \(form\.bankName!==initialForm\.bankName\|\|form\.accountNo!==initialForm\.accountNo\)/);
  assert.match(source,/function requestClose\(\)/);
  assert.match(source,/setDiscardConfirm\(true\)/);
  assert.match(source,/<ModalShell title="Profil Karyawan" onClose=\{requestClose\}/);
  assert.match(source,/onClick=\{requestClose\}/);
  assert.match(source,/Perubahan belum disimpan/);
  assert.match(source,/Buang perubahan/);
});
