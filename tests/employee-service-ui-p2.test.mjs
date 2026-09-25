import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employee Services UI P2: Advance Salary supports scalable page sizing',async()=>{
  const ui=await read('src/components/EwaInbox.tsx');
  assert.match(ui,/Jumlah baris per halaman/);
  assert.match(ui,/100 baris/);
  assert.match(ui,/limit:\s*String\(limit\)/);
});

test('Employee Services UI P2: Portal Audit uses scalable table controls and side drawer detail',async()=>{
  const ui=await read('src/components/PortalAudit.tsx');
  const styles=await read('src/app/employee-services.css');
  assert.match(ui,/Jumlah baris per halaman/);
  assert.match(ui,/100 baris/);
  assert.match(ui,/pa-table-wrap/);
  assert.match(ui,/es-drawer-backdrop/);
  assert.match(styles,/position:fixed/);
  assert.match(ui,/aria-modal="true"/);
  assert.match(ui,/Detail audit/);
});
