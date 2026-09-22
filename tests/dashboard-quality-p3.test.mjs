import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('dashboard components use typed contracts instead of any',async()=>{
  const [tower,clientHome,types,api]=await Promise.all([
    read('src/components/PayrollControlTower.tsx'),
    read('src/components/ClientHome.tsx'),
    read('src/lib/dashboard-types.ts'),
    read('src/lib/operating-model-api.ts'),
  ]);
  assert.doesNotMatch(tower,/\bany\b/);
  assert.doesNotMatch(clientHome,/\bany\b/);
  assert.match(tower,/DashboardPaymentInstruction/);
  assert.match(clientHome,/DashboardApiResponse/);
  assert.match(types,/export type DashboardSubmission/);
  assert.match(api,/Promise<DashboardApiResponse>/);
  assert.match(api,/Map<string, \{ expiresAt: number; data: unknown \}>/);
});

test('dashboard tables are accessible and become stacked cards on mobile',async()=>{
  const [tower,clientHome,css]=await Promise.all([
    read('src/components/PayrollControlTower.tsx'),
    read('src/components/ClientHome.tsx'),
    read('src/app/polish.css'),
  ]);
  for(const source of [tower,clientHome]){
    assert.match(source,/<caption className="visually-hidden">/);
    assert.match(source,/scope="col"/);
    assert.match(source,/data-label=/);
    assert.match(source,/dashboard-responsive-table/);
  }
  assert.match(tower,/role="status" aria-live="polite"/);
  assert.match(tower,/role="alert"/);
  assert.match(clientHome,/role="status" aria-live="polite"/);
  assert.match(clientHome,/role="alert"/);
  assert.match(css,/@media \(max-width:760px\)/);
  assert.match(css,/\.dashboard-responsive-table td::before/);
  assert.match(css,/content:attr\(data-label\)/);
  assert.match(css,/min-width:0 !important/);
});

test('Super Admin dashboard wording preserves financial segregation of duties',async()=>{
  const roleDashboard=await read('src/components/RoleDashboard.tsx');
  assert.match(roleDashboard,/maker-checker (?:dan|and) segregation of duties/);
  assert.match(roleDashboard,/tanpa bypass approval/);
  assert.doesNotMatch(roleDashboard,/Akses penuh untuk konfigurasi/);
  assert.match(roleDashboard,/review payroll pada tahap yang memang membutuhkan keputusan klien/);
});

test('unused legacy dashboard components are removed',async()=>{
  const removed=[
    'src/components/DashFilters.tsx',
    'src/components/MetricCard.tsx',
    'src/components/MetricPopup.tsx',
    'src/components/RegionMap.tsx',
    'src/components/WorkforceInsights.tsx',
  ];
  for(const path of removed){
    await assert.rejects(access(new URL('../'+path,import.meta.url)));
  }
});
