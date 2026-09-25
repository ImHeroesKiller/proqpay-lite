import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Portal Configuration visible redesign exposes control-center hierarchy',async()=>{
  const ui=await read('src/components/PortalSettings.tsx');
  const css=await read('src/app/employee-services.css');
  assert.match(ui,/Portal Configuration Control Center/);
  assert.match(ui,/portal-config-scope-card/);
  assert.match(ui,/portal-config-nav/);
  assert.match(ui,/portal-config-summary/);
  assert.match(ui,/portal-config-preview-card/);
  assert.match(css,/\.portal-config-hero\{/);
  assert.match(css,/\.portal-config-layout\{/);
  assert.match(css,/\.portal-config-summary-grid\{/);
  assert.match(css,/\.portal-config-preview-shell\{/);
});

test('Portal Configuration redesign preserves scope and save semantics',async()=>{
  const ui=await read('src/components/PortalSettings.tsx');
  assert.match(ui,/onClientChange/);
  assert.match(ui,/resetClient/);
  assert.match(ui,/dirty/);
  assert.match(ui,/Simpan perubahan/);
  assert.match(ui,/Kembali ke default org/);
});
