import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Portal Configuration shows one compact scope and contextual preview',async()=>{
  const ui=await read('src/components/PortalSettings.tsx');
  const css=await read('src/app/employee-services.css');
  assert.match(ui,/Pengaturan ESS/);
  assert.match(ui,/portal-config-scope-card/);
  assert.match(ui,/portal-config-nav/);
  assert.match(ui,/portal-config-summary/);
  assert.match(ui,/portal-config-preview-card/);
  assert.match(css,/\.portal-config-layout\{/);
  assert.match(css,/\.portal-config-layout:has\(\.portal-config-summary\)/);
  assert.match(ui,/tab === "copy" \? <aside className="portal-config-summary">/);
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
