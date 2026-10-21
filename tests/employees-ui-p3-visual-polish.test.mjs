import {readPolishCss} from './helpers/style-sources.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employees UI P3: centered profile popup uses shared modal, tabs and scroll body',async()=>{
  const detail=await read('src/components/EmployeeDetailDrawer.tsx');
  const css=await read('src/app/e2pay-wallet.css');
  assert.match(detail,/employee-profile-body/);
  assert.match(detail,/employee-avatar-lg/);
  assert.match(detail,/id="employee-detail-title"/);
  assert.match(detail,/aria-label="Detail Data Intake"/);
  assert.doesNotMatch(detail,/employee-drawer-pay/);
  assert.match(detail,/<ModalShell title="Profil Karyawan"/);
  assert.match(css,/\.employee-profile-body \{[^}]*overflow:auto/);
  assert.match(css,/\.employee-profile-summary/);
});

test('Employees UI P3: edit mode has dedicated shell and sticky save footer',async()=>{
  const detail=await read('src/components/EmployeeDetailDrawer.tsx');
  const css=await readPolishCss();
  assert.match(detail,/employee-edit-shell/);
  assert.match(detail,/employee-edit-heading/);
  assert.match(detail,/employee-edit-footer/);
  assert.match(detail,/disabled=\{saving\|\|!dirty\}/);
  assert.match(css,/\.employee-edit-footer \{[\s\S]*position:sticky[\s\S]*bottom:0/);
});

test('Employees UI P3: profile popup remains centered and bounded on mobile',async()=>{
  const css=await read('src/app/e2pay-wallet.css');
  assert.match(css,/width:min\(880px,100%\)/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/safe-area-inset-bottom/);
});

test('Employees UI P3: employee polish rules are consolidated into one final section',async()=>{
  const css=await readPolishCss();
  assert.match(css,/Employees UI — consolidated final layout/);
  assert.equal((css.match(/Employees UI — consolidated final layout/g)||[]).length,1);
  assert.doesNotMatch(css,/Employees UI P1 — functional hierarchy and mobile layout/);
  assert.doesNotMatch(css,/Employees UI P2 — operational UX hardening/);
  assert.doesNotMatch(css,/Employees P3 — maintainability, accessibility, responsive polish/);
});

test('Employees UI P3: detail section density is reduced and small mobile stacks to one column',async()=>{
  const css=await readPolishCss();
  assert.match(css,/\.employee-detail-groups section \{[\s\S]*padding:13px 14px/);
  assert.match(css,/\.employee-detail-groups dd \{[\s\S]*font-size:10px/);
  assert.match(css,/@media \(max-width:480px\)[\s\S]*\.employee-detail-groups dl \{ grid-template-columns:1fr !important; \}/);
});
