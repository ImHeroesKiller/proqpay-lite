import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employee Services UI P1: Advance Salary uses structured payout dialog and simplified filters',async()=>{
  const inbox=await read('src/components/EwaInbox.tsx');
  const dialog=await read('src/components/employee-services/DisbursementDialog.tsx');
  const styles=await read('src/app/employee-services.css');
  assert.doesNotMatch(inbox,/window\.prompt/);
  assert.match(inbox,/DisbursementDialog/);
  assert.match(inbox,/aria-label="Filter status"/);
  assert.match(inbox,/es-sticky-left/);
  assert.match(styles,/position:sticky/);
  assert.match(dialog,/Konfirmasi pencairan/);
  assert.match(dialog,/Rekening tujuan/);
  assert.match(dialog,/Referensi transaksi/);
});

test('Employee Services UI P1: Advance detail uses a side drawer dialog',async()=>{
  const detail=await read('src/components/employee-services/EwaLifecycle.tsx');
  const styles=await read('src/app/employee-services.css');
  assert.match(detail,/es-drawer-backdrop/);
  assert.match(styles,/justify-content:flex-end/);
  assert.match(detail,/aria-modal="true"/);
  assert.match(detail,/className="ewa-detail-panel es-drawer"/);
});

test('Employee Services UI P1: Portal Configuration protects unsaved changes and structures business sections',async()=>{
  const settings=await read('src/components/PortalSettings.tsx');
  assert.match(settings,/Perubahan belum disimpan/);
  assert.match(settings,/Simpan perubahan/);
  assert.match(settings,/Batalkan perubahan/);
  assert.match(settings,/Availability/);
  assert.match(settings,/Limit & fee/);
  assert.match(settings,/Eligibility/);
  assert.match(settings,/Repayment/);
  assert.match(settings,/Tampilan & tracking lanjutan/);
  assert.match(settings,/Portal Configuration/);
});

test('Employee Services UI P1: portal activity is integrated into the unified Audit Console',async()=>{
  const api=await read('functions/api/audit-console.js');
  const ui=await read('src/components/SystemLogs.tsx');
  assert.match(api,/portal_login_attempts/);
  assert.match(api,/EMPLOYEE_SERVICES/);
  assert.match(api,/params\.get\('from'\)/);
  assert.match(api,/params\.get\('to'\)/);
  assert.match(ui,/Audit Console/);
  assert.match(ui,/Employee Services/);
  assert.match(ui,/Unified event stream/);
});
