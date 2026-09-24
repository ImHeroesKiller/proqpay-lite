import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Data Readiness P1 enforces exception write permission for internal actors',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  const sec=await read('functions/api/_security.js');
  assert.match(api,/permissions\?\.includes\('exception:write'\)/);
  assert.match(api,/EXCEPTION_WRITE_PERMISSION_REQUIRED/);
  assert.match(sec,/PAYROLL_CONTROLLER: \['read', 'approval:write'/);
  assert.doesNotMatch(sec,/PAYROLL_CONTROLLER:[^\n]*exception:write/);
});

test('Data Readiness P1 keeps client acceptance separate from internal resolution',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  const validation=await read('functions/api/operating-model-validation.js');
  assert.match(api,/body\.status !== 'ACCEPTED' \|\| current\.status !== 'CLIENT_ACTION_REQUIRED'/);
  assert.match(api,/body\.status !== 'RESOLVED'/);
  assert.match(api,/INTERNAL_EXCEPTION_RESOLUTION_INVALID/);
  assert.match(validation,/\['ACCEPTED', 'RESOLVED'\]/);
  assert.doesNotMatch(validation,/ACCEPTED', 'REJECTED', 'RESOLVED/);
});

test('Data Readiness P1 reconciles submission state against all unresolved exceptions after client correction',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(api,/status NOT IN \('ACCEPTED','RESOLVED','AUTO_NORMALIZED'\)/);
  assert.match(api,/const nextState = Number\(remaining\?\.unresolved \|\| 0\) > 0 \? 'EXCEPTION_FOUND' : 'CLIENT_RESUBMITTED'/);
  assert.match(api,/CLIENT_CORRECTION_COMPLETED_INTERNAL_ISSUES_REMAIN/);
});

test('Data Readiness P1 audits exception request note and resolution actions',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(api,/PAYROLL_EXCEPTION_RESOLVED/);
  assert.match(api,/CLIENT_EXCEPTION_ACCEPTED/);
  assert.match(api,/PAYROLL_EXCEPTION_CLIENT_ACTION_REQUESTED/);
  assert.match(api,/PAYROLL_EXCEPTION_NOTE_ADDED/);
  assert.match(api,/'payroll_exception'/);
});

test('Data Readiness P1 exposes employee name and evidence fields in decision UI',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(api,/emp\.name AS employee_name/);
  assert.match(api,/LEFT JOIN employees emp ON emp\.id=e\.employee_id/);
  assert.match(ui,/readiness-evidence-panel/);
  assert.match(ui,/selected\.source_value/);
  assert.match(ui,/selected\.canonical_value/);
  assert.match(ui,/selected\.suggested_value/);
  assert.match(ui,/selected\.confidence/);
});

test('Data Readiness P1 requires evidence acknowledgement and meaningful resolution note',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  const validation=await read('functions/api/operating-model-validation.js');
  assert.match(ui,/evidenceReviewed/);
  assert.match(ui,/resolutionNote\.trim\(\)\.length<10/);
  assert.match(ui,/disabled=\{!evidenceReviewed \|\| resolutionNote\.trim\(\)\.length<10\}/);
  assert.match(validation,/resolutionNote wajib 10-1000 karakter/);
});

test('Data Readiness P1 removes Controller exception mutation affordances',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/canResolve=\{isProcessor \|\| isClient\}/);
  assert.match(ui,/\['SUPER_ADMIN','PAYROLL_PROCESSOR'\]\.includes\(role\)[\s\S]*Tambah catatan/);
});

test('Data Readiness P1 styles evidence-based resolution responsively',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Data Readiness P1/);
  assert.match(css,/\.readiness-evidence-panel/);
  assert.match(css,/\.readiness-evidence-grid/);
  assert.match(css,/\.readiness-resolution-panel/);
});
