import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Header work queue distinguishes loading/error/empty and routes approval domains separately', async()=>{
  const source=await read('src/components/AppHeader.tsx');
  assert.match(source,/alertsState.*"loading".*"ready".*"error"/s);
  assert.match(source,/Work queue unavailable\. Status pekerjaan belum dapat dipastikan/);
  assert.match(source,/Payroll approval/);
  assert.match(source,/Payment approval/);
  assert.match(source,/Invoice approval/);
  assert.match(source,/onNavigate\("operations"\)/);
  assert.match(source,/onNavigate\("payments"\)/);
  assert.match(source,/onNavigate\("billing"\)/);
  assert.match(source,/alertsState === "ready" && !totalAlerts/);
  assert.match(source,/alertsState === "ready" && totalAlerts/);
  assert.doesNotMatch(source,/catch\s*\{\s*setAlerts\(\{\s*exceptions:\s*0,\s*approvals:\s*0/s);
});

test('canonical global period is not overwritten by local DB change events', async()=>{
  const source=await read('src/app/page.tsx');
  const eventBlock=source.match(/const unsub = onDbChange\(\(\) => \{([\s\S]*?)\n    \}\);/)?.[1] || '';
  assert.match(eventBlock,/setDb\(fresh\)/);
  assert.doesNotMatch(eventBlock,/setPeriod\(/);
  assert.match(source,/listOperatingPeriods/);
});

test('Processor and Controller allowed views match the visible shell and cannot deep-link hidden Employee Portal admin modules', async()=>{
  const source=await read('src/components/Sidebar.tsx');
  const processor=source.match(/PAYROLL_PROCESSOR:\s*\[([\s\S]*?)\],\s*PAYROLL_CONTROLLER/)?.[1] || '';
  const controller=source.match(/PAYROLL_CONTROLLER:\s*\[([\s\S]*?)\],\s*CLIENT_USER/)?.[1] || '';
  for (const block of [processor,controller]) {
    assert.doesNotMatch(block,/"ewa"/);
    assert.doesNotMatch(block,/"portalAudit"/);
    assert.doesNotMatch(block,/"portalSettings"/);
  }
  assert.match(source,/role === "SUPER_ADMIN".*label="Employee Services"/s);
});

test('footer is the canonical production health and sync surface while sidebar stays navigation-focused', async()=>{
  const sidebar=await read('src/components/Sidebar.tsx');
  const footer=await read('src/components/AppFooter.tsx');
  const health=await read('src/lib/service-health.ts');
  assert.doesNotMatch(sidebar,/useServiceHealth/);
  assert.doesNotMatch(sidebar,/Production ·/);
  assert.doesNotMatch(sidebar,/syncLabel/);
  assert.match(footer,/useServiceHealth/);
  assert.match(footer,/Production · \{state === "connected"/);
  assert.match(footer,/syncLabel\(lastSyncAt, now\)/);
  assert.match(health,/fetch\("\/api\/health"/);
});
