import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employees UI P1: inactive-like statuses are never painted as success',async()=>{
  const source=await read('src/lib/employee-ui.ts');
  assert.match(source,/non\[ -\]\?aktif/);
  assert.ok(source.indexOf("return 'danger'") < source.indexOf("return 'success'"));
});

test('Employees UI P1: employee management controls require employees:write permission',async()=>{
  const source=await read('src/lib/employee-ui.ts');
  assert.match(source,/actor\.permissions\?\.includes\('employees:write'\)/);
});

test('Employees UI P1: active KPI is independent from contract-expired KPI',async()=>{
  const source=await read('src/components/EmployeeDirectory.tsx');
  assert.match(source,/if\(Number\.isFinite\(end\)&&end<now\) expired\+=1;\s*if\(employee\.isActive===true\) active\+=1;/s);
  assert.doesNotMatch(source,/else if\(employee\.isActive===true\)/);
});

test('Employees UI P1: ESS credential management is a secondary header action modal',async()=>{
  const directory=await read('src/components/EmployeeDirectory.tsx');
  const credential=await read('src/components/EmployeeCredentialsPanel.tsx');
  assert.match(directory,/employee-page-actions/);
  assert.match(directory,/EmployeeCredentialsPanel actor=\{actor\}/);
  assert.match(credential,/Kelola akses ESS/);
  assert.match(credential,/employee-ess-modal/);
  assert.doesNotMatch(credential,/portal-credentials-card card/);
  assert.match(credential,/disabled=\{busy \|\| loading \|\| summary == null \|\| summary\.pending === 0\}/);
});

test('Employees UI P1: mobile uses employee cards instead of 940px desktop table',async()=>{
  const directory=await read('src/components/EmployeeDirectory.tsx');
  const css=await read('src/app/polish.css');
  assert.match(directory,/employee-mobile-list/);
  assert.match(directory,/employee-mobile-card/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.employee-table \{\s*display:none;/);
  assert.match(css,/\.employee-mobile-list \{\s*display:grid;/);
});
