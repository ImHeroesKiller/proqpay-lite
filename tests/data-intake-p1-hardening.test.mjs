import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Data Intake P1 restricts mutation and setup to operational import roles',async()=>{
  const api=await read('functions/api/payroll-intake.js');
  const setup=await read('functions/api/payroll-intake-setup.js');
  assert.match(api,/const ROLES = \["SUPER_ADMIN", "PAYROLL_PROCESSOR"\]/);
  assert.match(api,/permissions\?\.includes\("import:write"\)/);
  assert.match(setup,/const ROLES=\['SUPER_ADMIN','PAYROLL_PROCESSOR'\]/);
});

test('Data Intake P1 parses canonical rows from hashed file bytes on the server',async()=>{
  const api=await read('functions/api/payroll-intake.js');
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(api,/parseIapWorkbook\(bytes\)/);
  assert.match(api,/const rows = parsedSource\.rows/);
  assert.match(api,/const fileHash = await sha256Hex\(bytes\)/);
  assert.match(api,/JSON\.stringify\(rows\[i\]\)/);
  assert.doesNotMatch(ui,/data\.set\("rows"/);
  assert.doesNotMatch(ui,/data\.set\("sourceSheet"/);
  assert.doesNotMatch(ui,/data\.set\("rawRowCount"/);
});

test('Data Intake P1 derives client code from D1 instead of trusting browser context',async()=>{
  const api=await read('functions/api/payroll-intake.js');
  assert.match(api,/c\.code AS client_code/);
  assert.match(api,/clientCode: project\.client_code/);
  assert.match(api,/String\(context\.clientCode\)\.toUpperCase\(\)/);
  assert.doesNotMatch(api,/context\.clientCode \|\| row\.clientCode/);
});

test('Data Intake P1 supports audited backend reset for unconfirmed batches',async()=>{
  const api=await read('functions/api/payroll-intake.js');
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(api,/async function resetIntake/);
  assert.match(api,/status='CANCELLED'/);
  assert.match(api,/PAYROLL_INTAKE_RESET/);
  assert.match(ui,/action:"RESET"/);
  assert.match(ui,/Batalkan intake/);
});

test('Data Intake P1 detects and requires explicit project transfer confirmation',async()=>{
  const api=await read('functions/api/payroll-intake.js');
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(api,/const clientEmployees = await d1All/);
  assert.match(api,/const transfers = \[\]/);
  assert.match(api,/PROJECT_TRANSFER_CONFIRMATION_REQUIRED/);
  assert.match(api,/employee\.project_id/);
  assert.match(ui,/transferConfirmations/);
  assert.match(ui,/Perpindahan project terdeteksi/);
  assert.match(ui,/Mutasi project/);
  assert.match(ui,/!transfersComplete/);
});
