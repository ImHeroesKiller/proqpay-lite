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

test('Employee Services UI P2: unified Audit Logs supports scalable controls and detail drawer',async()=>{
  const ui=await read('src/components/SystemLogs.tsx');
  const styles=await read('src/app/audit-console.css');
  assert.match(ui,/option value=\{25\}/);
  assert.match(ui,/option value=\{100\}/);
  assert.match(ui,/audit-table-wrap/);
  assert.match(ui,/es-drawer-backdrop/);
  assert.match(styles,/position:sticky/);
  assert.match(ui,/aria-modal="true"/);
  assert.match(ui,/AUDIT DETAIL/);
});
