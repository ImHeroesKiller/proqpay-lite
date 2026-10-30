import {readPolishCss} from './helpers/style-sources.mjs';
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

test('Employees directory uses canonical activity and ESS state without completeness checks',async()=>{
 const directory=await read('src/components/EmployeeDirectory.tsx');
 assert.match(directory,/employee.isActive===true/);
 assert.match(directory,/employeeEssStatus/);
 assert.doesNotMatch(directory,/employeeIssues|Kelengkapan|Perlu dilengkapi|<th>Kontrak<\/th>/);
 assert.match(directory,/<th>Status ESS<\/th>/);
});

test('Employees ESS generation is individual in the profile, with no bulk management panel',async()=>{
 const directory=await read('src/components/EmployeeDirectory.tsx');
 const detail=await read('src/components/EmployeeDetailDrawer.tsx');
 assert.doesNotMatch(directory,/EmployeeCredentialsPanel|Kelola akses ESS/);
 assert.match(detail,/Generate password ESS/);
 assert.match(detail,/action:'RESET',employeeId:employee.id/);
 assert.match(detail,/Password ESS<input type="text" value=\{portalPassword\} readOnly/);
});

test('Employees UI P1: mobile uses employee cards instead of 940px desktop table',async()=>{
  const directory=await read('src/components/EmployeeDirectory.tsx');
  const css=await readPolishCss();
  assert.match(directory,/employee-mobile-list/);
  assert.match(directory,/employee-mobile-card/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.employee-table \{\s*display:none;/);
  assert.match(css,/\.employee-mobile-list \{\s*display:grid;/);
});
