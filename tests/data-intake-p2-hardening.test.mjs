import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Data Intake P2 blocks duplicate NRK both client and server side',async()=>{
  const api=await read('functions/api/payroll-intake.js');
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(api,/PAYROLL_DUPLICATE_NRK/);
  assert.match(api,/parsedSource\.duplicateRows > 0/);
  assert.match(ui,/result\.duplicateRows > 0/);
  assert.match(ui,/Perbaiki file sebelum melanjutkan/);
});

test('Data Intake P2 enforces xlsx-only source contract',async()=>{
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(ui,/if \(!\/\\\.xlsx\$\/i\.test\(chosen\.name\)\)/);
  assert.match(ui,/accept=".xlsx"/);
  assert.doesNotMatch(ui,/\.xlsx,\.xls/);
});

test('Data Intake P2 protects unconfirmed backend previews from accidental navigation',async()=>{
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(ui,/beforeunload/);
  assert.match(ui,/preview\?\.batchId && !preview\.confirmed/);
  assert.match(ui,/window\.confirm\("Intake belum dikonfirmasi/);
});

test('Data Intake P2 exposes workbook diagnostics and typed notices',async()=>{
  const api=await read('functions/api/payroll-intake.js');
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(api,/diagnostics: parsedSource\.diagnostics/);
  assert.match(ui,/intake-diagnostics/);
  assert.match(ui,/messageTone/);
  assert.match(ui,/app-notice-success/);
  assert.match(ui,/app-notice-warning/);
  assert.doesNotMatch(ui,/\/gagal\|error\|tidak\|wajib\|valid\/i\.test\(message\)/);
});

test('Data Intake P2 renders masked before-after review for changed master fields',async()=>{
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(ui,/intake-change-fields/);
  assert.match(ui,/displayChangeValue/);
  assert.match(ui,/\["accountNo","ktp","npwp"\]/);
  assert.match(ui,/item\.before\?\.\[field\]/);
  assert.match(ui,/item\.after\?\.\[field\]/);
});

test('Data Intake P2 can recover an APPLYING confirmation retry',async()=>{
  const api=await read('functions/api/payroll-intake.js');
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(api,/const recovering = batch\.status === "APPLYING"/);
  assert.match(api,/recovered: recovering/);
  assert.match(ui,/payload\.recovered/);
  assert.match(ui,/berhasil dipulihkan dan dikonfirmasi/);
});

test('Data Intake P2 missing transfer requires and applies an active target project',async()=>{
  const api=await read('functions/api/payroll-intake.js');
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(api,/MISSING_EMPLOYEE_TRANSFER_TARGET_REQUIRED/);
  assert.match(api,/SELECT id FROM projects WHERE id=\? AND client_id=\? AND org_id=\? AND status='ACTIVE'/);
  assert.match(api,/UPDATE employees SET project_id=\?/);
  assert.match(api,/\["projectId"\]/);
  assert.match(ui,/targetProjectId/);
  assert.match(ui,/Pilih target project/);
});

test('Data Intake P2 adds responsive diagnostics and change-review styling',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Data Intake P2/);
  assert.match(css,/\.intake-diagnostics-grid/);
  assert.match(css,/\.intake-change-fields/);
  assert.match(css,/\.intake-transfer-row/);
});
