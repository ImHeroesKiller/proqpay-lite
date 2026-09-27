import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('P3 unified visual system centralizes semantic polish tokens',async()=>{
  const css=await read('src/app/globals.css');
  assert.match(css,/P3 Unified Visual Polish & Maintainability/);
  for(const token of ['--success-strong','--warning-strong','--danger-strong','--ui-density-row','--ui-control-height']){
    assert.match(css,new RegExp(token));
  }
  assert.match(css,/\.ui-filter-grid input:focus-visible/);
  assert.match(css,/\.ui-action-bar-sticky/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
});

test('P3 keeps priority workspace layout styling out of Portal Settings and bounded in Billing',async()=>{
  const [portal,billing]=await Promise.all([
    read('src/components/PortalSettings.tsx'),
    read('src/components/BillingWorkspace.tsx'),
  ]);
  assert.equal((portal.match(/style=\{\{/g)||[]).length,0);
  assert.ok((billing.match(/style=\{\{/g)||[]).length<=3,'Billing structural inline styles must remain bounded');
  assert.match(portal,/ui-banner-grid/);
  assert.match(portal,/ui-settings-panel/);
  assert.match(billing,/billing-metric-grid/);
  assert.match(billing,/ui-activity-list/);
});

test('P3 shared visual semantics replace hard-coded status colors in unified components',async()=>{
  const css=await read('src/app/globals.css');
  assert.match(css,/\.ui-status-success\{color:var\(--success-strong\)/);
  assert.match(css,/\.ui-status-warning\{color:var\(--warning-strong\)/);
  assert.match(css,/\.ui-status-danger\{color:var\(--danger-strong\)/);
});
