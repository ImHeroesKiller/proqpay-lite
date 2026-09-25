import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employee Service EWA inbox keeps pending summary independent from status filter',async()=>{
  const api=await read('functions/api/ewa.js');
  assert.match(api,/SUM\(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END\) AS pending/);
  assert.match(api,/COUNT\(\*\) AS total/);
  assert.doesNotMatch(api,/const pending = rows\.filter/);
});

test('Employee Service EWA inbox exposes cancelled lifecycle records',async()=>{
  const shared=await read('src/lib/employee-services.ts');
  assert.match(shared,/"CANCELLED"/);
});


test('Employee Service P2: EWA admin exposes lifecycle facets, retry and responsive mobile cards',async()=>{
  const api=await read('functions/api/ewa.js');
  const ui=await read('src/components/EwaInbox.tsx');
  const states=await read('src/components/employee-services/OperationalState.tsx');
  const details=await read('src/components/employee-services/EwaLifecycle.tsx');
  assert.match(api,/statusCounts/);
  assert.match(api,/SELECT DISTINCT c\.id,c\.name/);
  assert.match(states,/Coba lagi/);
  assert.match(states,/aria-busy="true"/);
  assert.match(ui,/ewa-mobile-card/);
  assert.match(details,/ewa-detail-panel/);
  assert.match(details,/Tutup detail advance/);
  assert.match(ui,/Perbarui|Refresh/);
});

test('Employee Service P2: Portal Audit has explicit loading, recovery, empty and mobile states',async()=>{
  const ui=await read('src/components/PortalAudit.tsx');
  const states=await read('src/components/employee-services/OperationalState.tsx');
  assert.match(ui,/Memuat jejak audit portal/);
  assert.match(states,/Coba lagi/);
  assert.match(ui,/Belum ada jejak audit/);
  assert.match(ui,/pa-mobile/);
  assert.match(ui,/Detail audit/);
});
