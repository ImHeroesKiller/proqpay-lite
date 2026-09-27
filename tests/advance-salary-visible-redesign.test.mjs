import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Advance Salary visible redesign has a distinct control-center hierarchy',async()=>{
  const ui=await read('src/components/EwaInbox.tsx');
  const css=await read('src/app/employee-services.css');
  const unified=await read('src/components/ui/UnifiedSystem.tsx');
  const globalCss=await read('src/app/globals.css');
  assert.match(ui,/Advance Salary Control Center/);
  assert.match(ui,/UiWorkspaceHeader/);
  assert.match(ui,/UiMetricGrid/);
  assert.match(ui,/ewa-filter-panel/);
  assert.match(ui,/ewa-list-card/);
  assert.match(ui,/UiMetricCard/);
  assert.match(unified,/function WorkspaceHeader/);
  assert.match(unified,/function MetricCard/);
  assert.match(globalCss,/\.ui-workspace-header\{/);
  assert.match(globalCss,/\.ui-metric-card\{/);
  assert.match(css,/\.ewa-filter-grid\{/);
  assert.match(css,/\.ewa-list-head\{/);
  assert.match(css,/\.ewa-mobile-submitted::before/);
});
