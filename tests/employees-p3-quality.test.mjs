import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employees P3: typed employee UI contracts centralize record, actor, admin and credential shapes',async()=>{
  const source=await read('src/lib/employee-ui.ts');
  assert.match(source,/export type EmployeeRecord/);
  assert.match(source,/export type EmployeeActor/);
  assert.match(source,/export type EmployeeAdminForm/);
  assert.match(source,/export type PortalCredentialRow/);
  assert.match(source,/export function employeeIssues/);
  assert.match(source,/export function employeeStatusTone/);
  assert.match(source,/export function canManageEmployees/);
});

test('Employees P3: EmployeeDirectory is slim orchestration using extracted typed components',async()=>{
  const source=await read('src/components/EmployeeDirectory.tsx');
  assert.match(source,/EmployeeCredentialsPanel/);
  assert.match(source,/EmployeeDetailDrawer/);
  assert.match(source,/type EmployeeRecord/);
  assert.match(source,/employees: EmployeeRecord\[\]/);
  assert.doesNotMatch(source,/function PortalCredentialsPanel/);
  assert.doesNotMatch(source,/function EmployeeDetail/);
  assert.doesNotMatch(source,/employees: any\[\]/);
});

test('Employees P3: native confirm dialogs are removed from employee flows',async()=>{
  const directory=await read('src/components/EmployeeDirectory.tsx');
  const detail=await read('src/components/EmployeeDetailDrawer.tsx');
  const credentials=await read('src/components/EmployeeCredentialsPanel.tsx');
  assert.doesNotMatch(directory,/window\.confirm/);
  assert.doesNotMatch(detail,/window\.confirm/);
  assert.doesNotMatch(credentials,/window\.confirm/);
  assert.match(credentials,/Terbitkan password sementara\?/);
  assert.match(detail,/Terbitkan ulang password portal\?/);
});

test('Employees P3: detail drawer handles Escape, focus trap and keyboard row activation',async()=>{
  const directory=await read('src/components/EmployeeDirectory.tsx');
  const detail=await read('src/components/EmployeeDetailDrawer.tsx');
  assert.match(detail,/event\.key==='Escape'/);
  assert.match(detail,/event\.key==='Tab'/);
  assert.match(detail,/aria-labelledby="employee-detail-title"/);
  assert.match(detail,/closeRef\.current\?\.focus/);
  assert.match(directory,/event\.key==='Enter'\|\|event\.key===' '/);
});

test('Employees P3: responsive polish hooks cover drawer, structured admin form and credential confirmation',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Employees P3/);
  assert.match(css,/\.employee-admin-form/);
  assert.match(css,/\.employee-confirm-backdrop/);
  assert.match(css,/\.employee-confirm-modal/);
  assert.match(css,/\.employee-inline-confirm/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.employee-confirm-modal/);
});
