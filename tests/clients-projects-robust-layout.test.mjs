import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Clients & Projects keeps the existing page title while adopting robust shared layout',async()=>{
  const source=await read('src/components/DirectoryManager.tsx');
  assert.match(source,/<h2>Klien & Project<\/h2>/);
  assert.match(source,/UiMetricGrid/);
  assert.match(source,/UiFilterBar/);
  assert.match(source,/UiTabs/);
  assert.match(source,/UiSectionCard/);
  assert.match(source,/UiPagination/);
  assert.match(source,/UiDataTableState/);
  assert.match(source,/directory-entity-card/);
  assert.doesNotMatch(source,/className="directory-grid"/);
  assert.doesNotMatch(source,/DirectoryPager/);
});

test('Clients & Projects responsive layout is centralized in the design system CSS',async()=>{
  const css=await read('src/app/globals.css');
  assert.match(css,/Clients & Projects — robust master workspace/);
  assert.match(css,/\.directory-entity-card\{/);
  assert.match(css,/\.directory-filter-bar \.ui-filter-grid/);
  assert.match(css,/@media \(max-width:700px\)/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
});
