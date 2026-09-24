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
  assert.match(source,/role === "SUPER_ADMIN".*NavGroup label="Employee Portal"/s);
});

test('sidebar production connectivity is derived from live health instead of a hardcoded green claim', async()=>{
  const source=await read('src/components/Sidebar.tsx');
  assert.match(source,/fetch\("\/api\/health"/);
  assert.match(source,/result\.ready === true \? "connected" : "degraded"/);
  assert.match(source,/"offline"/);
  assert.match(source,/Production · \{serviceState === "connected"/);
  assert.doesNotMatch(source,/Production · Connected\s*<\/span>/);
  const css=await read('src/app/globals.css');
  assert.match(css,/sidebar-health-connected/);
  assert.match(css,/sidebar-health-degraded/);
  assert.match(css,/sidebar-health-offline/);
});
