import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Header search supports keyboard combobox navigation and profile dialog focus containment', async()=>{
  const source=await read('src/components/AppHeader.tsx');
  assert.match(source,/role="combobox"/);
  assert.match(source,/role="listbox"/);
  assert.match(source,/role="option"/);
  assert.match(source,/ArrowDown/);
  assert.match(source,/ArrowUp/);
  assert.match(source,/aria-activedescendant/);
  assert.match(source,/profileRef/);
  assert.match(source,/event\.key !== "Tab"/);
  assert.match(source,/event\.key === "Escape"/);
  assert.match(source,/accountButtonRef/);
  assert.doesNotMatch(source,/\bany\b/);
});

test('Sidebar mobile drawer locks page scroll, traps focus, restores focus, and labels compact navigation', async()=>{
  const source=await read('src/components/Sidebar.tsx');
  assert.match(source,/document\.body\.style\.overflow = "hidden"/);
  assert.match(source,/previousFocusRef/);
  assert.match(source,/event\.key === "Escape"/);
  assert.match(source,/event\.key !== "Tab"/);
  assert.match(source,/previousFocusRef\.current\?\.focus/);
  assert.match(source,/aria-label=\{title\}/);
  assert.match(source,/aria-label="Data Intake"/);
});

test('Data Intake uses client-side Link and preserves global payroll period in both directions', async()=>{
  const sidebar=await read('src/components/Sidebar.tsx');
  const intake=await read('src/app/data-intake/page.tsx');
  const home=await read('src/app/page.tsx');
  assert.match(sidebar,/import Link from "next\/link"/);
  assert.match(sidebar,/\/data-intake\?period=/);
  assert.match(intake,/new URLSearchParams\(window\.location\.search\)\.get\("period"\)/);
  assert.match(intake,/\?view=\$\{view\}&period=/);
  assert.match(intake,/\?view=operations&period=/);
  assert.match(home,/params\.get\('period'\)/);
  assert.match(home,/url\.searchParams\.set\('period', p\)/);
  assert.match(home,/url\.searchParams\.set\('period', period\)/);
});

test('Header client scope uses canonical D1 dashboard summary instead of local company count', async()=>{
  const source=await read('src/app/page.tsx');
  assert.match(source,/canonicalClientCount/);
  assert.match(source,/listOperatingDashboard\(undefined, period\)/);
  assert.match(source,/result\.portfolioSummary\?\.clients/);
  assert.match(source,/clientCount=\{canonicalClientCount\}/);
  assert.doesNotMatch(source,/clientCount=\{actor\.role==='CLIENT_USER'.*db\.companies/s);
});

test('Settings chunk mounts only when settings are open and sync age refreshes over time', async()=>{
  const source=await read('src/components/Sidebar.tsx');
  assert.match(source,/settingsOpen \? <SettingsModal/);
  assert.match(source,/setInterval\(\(\) => setNow\(Date\.now\(\)\), 60_000\)/);
  assert.match(source,/syncLabel\(lastSyncAt, now\)/);
});

test('Shell has a compact utility footer with environment, version, health, sync and support', async()=>{
  const footer=await read('src/components/AppFooter.tsx');
  const page=await read('src/app/page.tsx');
  const css=await read('src/app/globals.css');
  assert.match(page,/import AppFooter/);
  assert.match(page,/<AppFooter/);
  assert.match(footer,/<footer className="app-footer"/);
  assert.match(footer,/packageInfo\.version/);
  assert.match(footer,/Production · \{state === "connected"/);
  assert.match(footer,/syncLabel\(lastSyncAt, now\)/);
  assert.match(footer,/>Support<\/button>/);
  assert.match(css,/\.app-footer/);
});

test('Sidebar, footer, and System Health share one cached health source', async()=>{
  const health=await read('src/lib/service-health.ts');
  const sidebar=await read('src/components/Sidebar.tsx');
  const footer=await read('src/components/AppFooter.tsx');
  const bubble=await read('src/components/SystemHealthBubble.tsx');
  assert.match(health,/cachedHealth/);
  assert.match(health,/inflight/);
  assert.match(health,/Date\.now\(\) - lastFetchedAt < 30_000/);
  assert.match(sidebar,/useServiceHealth/);
  assert.match(footer,/useServiceHealth/);
  assert.match(bubble,/useServiceHealth/);
  assert.doesNotMatch(sidebar,/fetch\("\/api\/health"/);
  assert.doesNotMatch(bubble,/fetch\('\/api\/health'/);
});
