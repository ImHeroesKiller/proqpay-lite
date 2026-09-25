import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employees UI P3: detail drawer uses sticky header, scroll body and compact profile hero',async()=>{
  const detail=await read('src/components/EmployeeDetailDrawer.tsx');
  const css=await read('src/app/polish.css');
  assert.match(detail,/employee-drawer-body/);
  assert.match(detail,/employee-profile-hero/);
  assert.doesNotMatch(detail,/employee-drawer-pay/);
  assert.match(css,/\.employee-drawer-header \{[\s\S]*position:sticky/);
  assert.match(css,/\.employee-drawer-body \{[\s\S]*overflow:auto/);
  assert.match(css,/\.employee-profile-hero/);
});

test('Employees UI P3: edit mode has dedicated shell and sticky save footer',async()=>{
  const detail=await read('src/components/EmployeeDetailDrawer.tsx');
  const css=await read('src/app/polish.css');
  assert.match(detail,/employee-edit-shell/);
  assert.match(detail,/employee-edit-heading/);
  assert.match(detail,/employee-edit-footer/);
  assert.match(detail,/disabled=\{saving\|\|!dirty\}/);
  assert.match(css,/\.employee-edit-footer \{[\s\S]*position:sticky[\s\S]*bottom:0/);
});

test('Employees UI P3: mobile detail is a true full-screen view',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.employee-drawer \{[\s\S]*position:fixed !important;[\s\S]*inset:0 !important;[\s\S]*height:100dvh !important;/);
  assert.match(css,/\.employee-drawer-backdrop \{ background:var\(--bg-surface\); backdrop-filter:none; \}/);
  assert.match(css,/safe-area-inset-bottom/);
});

test('Employees UI P3: employee polish rules are consolidated into one final section',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Employees UI — consolidated final layout/);
  assert.equal((css.match(/Employees UI — consolidated final layout/g)||[]).length,1);
  assert.doesNotMatch(css,/Employees UI P1 — functional hierarchy and mobile layout/);
  assert.doesNotMatch(css,/Employees UI P2 — operational UX hardening/);
  assert.doesNotMatch(css,/Employees P3 — maintainability, accessibility, responsive polish/);
});

test('Employees UI P3: detail section density is reduced and small mobile stacks to one column',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/\.employee-detail-groups section \{[\s\S]*padding:13px 14px/);
  assert.match(css,/\.employee-detail-groups dd \{[\s\S]*font-size:10px/);
  assert.match(css,/@media \(max-width:480px\)[\s\S]*\.employee-detail-groups dl \{ grid-template-columns:1fr !important; \}/);
});
