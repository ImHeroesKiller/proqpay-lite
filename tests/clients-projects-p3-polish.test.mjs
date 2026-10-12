import {readGlobalCss, readPolishCss} from './helpers/style-sources.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Clients & Projects P3 replaces explanatory cards with operational summary metrics',async()=>{
  const ui=await read('src/components/DirectoryManager.tsx');
  assert.match(ui,/directory-inline-stats/);
  assert.doesNotMatch(ui,/UiMetricGrid/);
  assert.match(ui,/klien aktif/);
  assert.match(ui,/project aktif/);
  assert.match(ui,/totalEmployees/);
  assert.match(ui,/assignedAccounts/);
  assert.doesNotMatch(ui,/1\. Klien/);
});

test('Clients & Projects P3 uses grouped modal sections and read-only code presentation',async()=>{
  const ui=await read('src/components/DirectoryManager.tsx');
  assert.match(ui,/Profil & Kontak/);
  assert.match(ui,/Legal & Tax/);
  assert.match(ui,/Billing & Financial/);
  assert.match(ui,/Project Profile/);
  assert.match(ui,/Service Tier/);
  assert.match(ui,/Periode & Scope/);
  assert.match(ui,/directory-code-field/);
  assert.doesNotMatch(ui,/Kode otomatis<input/);
});

test('Clients & Projects P3 reduces row density with metadata chips',async()=>{
  const ui=await read('src/components/DirectoryManager.tsx');
  assert.match(ui,/directory-entity-meta/);
  assert.match(ui,/directory-entity-copy/);
  assert.match(ui,/filteredClients\.length/);
  assert.match(ui,/filteredProjects\.length/);
});

test('Clients & Projects P3 adds detail hierarchy and mobile ergonomics',async()=>{
  const ui=await read('src/components/DirectoryManager.tsx');
  const css=await readPolishCss();
  assert.match(ui,/directory-detail-hero/);
  assert.match(css,/Clients & Projects P3/);
  assert.match(css,/\.directory-form-card/);
  assert.match(css,/\.directory-code-field code/);
  assert.match(css,/\.directory-detail-hero/);
  assert.match(css,/\.directory-modal-actions \{[\s\S]*position:sticky/);
  const globals=await readGlobalCss();
  assert.match(globals,/Clients & Projects — robust master workspace/);
  assert.match(globals,/\.directory-entity-card\{/);
});
