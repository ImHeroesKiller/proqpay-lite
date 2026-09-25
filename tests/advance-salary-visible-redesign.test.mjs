import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Advance Salary visible redesign has a distinct control-center hierarchy',async()=>{
  const ui=await read('src/components/EwaInbox.tsx');
  const css=await read('src/app/employee-services.css');
  assert.match(ui,/Advance Salary Control Center/);
  assert.match(ui,/ewa-hero/);
  assert.match(ui,/ewa-filter-panel/);
  assert.match(ui,/ewa-list-card/);
  assert.match(ui,/item\.key\.toLowerCase\(\)/);
  assert.match(css,/\.ewa-summary-submitted/);
  assert.match(css,/\.ewa-hero\{/);
  assert.match(css,/\.ewa-filter-grid\{/);
  assert.match(css,/\.ewa-list-head\{/);
  assert.match(css,/\.ewa-mobile-submitted::before/);
});
