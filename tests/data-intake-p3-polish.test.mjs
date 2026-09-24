import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Data Intake P3 marks all workflow steps complete after confirmation',async()=>{
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(ui,/preview\?\.confirmed\s*\? "done"/);
  assert.match(ui,/preview\?\.confirmed \|\| index \+ 1 < progress \? "✓"/);
});

test('Data Intake P3 adds sticky payroll scope summary and control equation',async()=>{
  const ui=await read('src/app/data-intake/page.tsx');
  const css=await read('src/app/polish.css');
  assert.match(ui,/intake-scope-summary/);
  assert.match(ui,/Control total payroll/);
  assert.match(ui,/Gross/);
  assert.match(ui,/Deduction/);
  assert.match(ui,/Net \/ THP/);
  assert.match(css,/\.intake-scope-summary \{[\s\S]*position:sticky/);
  assert.match(css,/\.intake-control-equation/);
});

test('Data Intake P3 supports review category filters',async()=>{
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(ui,/reviewFilter/);
  assert.match(ui,/Filter review perubahan/);
  assert.match(ui,/reviewFilter==="CHANGED"/);
  assert.match(ui,/reviewFilter==="NEW"/);
  assert.match(ui,/reviewFilter==="TRANSFER"/);
  assert.match(ui,/reviewFilter==="MISSING"/);
});

test('Data Intake P3 improves new employee and resolution hierarchy',async()=>{
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(ui,/intake-new-grid/);
  assert.match(ui,/intake-resolution-legend/);
  assert.match(ui,/No pay/);
  assert.match(ui,/Resign/);
  assert.match(ui,/Mutasi/);
});

test('Data Intake P3 shows readiness before final confirmation',async()=>{
  const ui=await read('src/app/data-intake/page.tsx');
  assert.match(ui,/intake-review-readiness/);
  assert.match(ui,/Missing resolution/);
  assert.match(ui,/Transfer confirmation/);
  assert.match(ui,/Snapshot/);
});

test('Data Intake P3 mobile review remains compact and touch friendly',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Data Intake P3/);
  assert.match(css,/\.intake-review-toolbar[\s\S]*overflow-x:auto/);
  assert.match(css,/\.intake-missing-row[\s\S]*grid-template-columns:1fr !important/);
  assert.match(css,/min-height:42px/);
});
