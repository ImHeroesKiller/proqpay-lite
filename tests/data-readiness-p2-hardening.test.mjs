import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Data Readiness P2 paginates exception API with explicit metadata',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  assert.match(api,/exceptionOffset/);
  assert.match(api,/exceptionLimit/);
  assert.match(api,/LIMIT \? OFFSET \?/);
  assert.match(api,/exceptionsMeta/);
  assert.match(api,/nextOffset:truncated \? exceptionOffset \+ exceptionLimit : null/);
});

test('Data Readiness P2 aggregates all exception pages for workspace completeness',async()=>{
  const client=await read('src/lib/operating-model-api.ts');
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(client,/listAllOperatingExceptions/);
  assert.match(client,/while\(true\)/);
  assert.match(client,/page\.exceptionsMeta\?\.nextOffset/);
  assert.match(ui,/resource === 'exceptions' \? listAllOperatingExceptions/);
});

test('Data Readiness P2 uses readiness-specific search and active-status semantics',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/status === 'ALL' \|\| \(status==='ACTIVE' \? !isClosed\(row\)/);
  assert.match(ui,/Cari karyawan, alasan, field, klien, project/);
  assert.match(ui,/mode==='actions' \? true/);
  assert.match(ui,/mode!=='actions'\?<label className="operations-search"/);
});

test('Data Readiness P2 replaces browser prompts with proper composer',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/readiness-message-composer/);
  assert.match(ui,/actionMode/);
  assert.match(ui,/submitMessage/);
  assert.doesNotMatch(ui,/window\.prompt\('Instruksi perbaikan untuk user klien/);
  assert.doesNotMatch(ui,/window\.prompt\('Tulis pesan pada temuan/);
});

test('Data Readiness P2 loads an audit timeline scoped to exception',async()=>{
  const api=await read('functions/api/operating-model-d1.js');
  const client=await read('src/lib/operating-model-api.ts');
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(api,/resource === 'exception-history'/);
  assert.match(api,/entity='payroll_exception' AND entity_id=\?/);
  assert.match(client,/getExceptionHistory/);
  assert.match(ui,/readiness-timeline/);
  assert.match(ui,/Audit timeline/);
});

test('Data Readiness P2 modal supports escape focus trap restore and scroll lock',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/dialogRef=useRef<HTMLDivElement>/);
  assert.match(ui,/document\.body\.style\.overflow='hidden'/);
  assert.match(ui,/event\.key==='Escape'/);
  assert.match(ui,/event\.key!=='Tab'/);
  assert.match(ui,/previousFocusRef\.current\?\.focus\(\)/);
});

test('Data Readiness P2 clamps and resets pagination safely',async()=>{
  const ui=await read('src/components/OperatingWorkspace.tsx');
  assert.match(ui,/useEffect\(\(\)=>setPage\(1\),\[severity,status,query\]\)/);
  assert.match(ui,/setPage\(\(current\)=>Math\.min\(current,pageCount\)\)/);
  assert.match(ui,/Math\.max\(1,p-1\)/);
  assert.match(ui,/Math\.min\(pageCount,p\+1\)/);
});

test('Data Readiness P2 styles filter timeline composer and mobile actions',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Data Readiness P2/);
  assert.match(css,/\.readiness-filter-bar/);
  assert.match(css,/\.readiness-timeline/);
  assert.match(css,/\.readiness-message-composer/);
  assert.match(css,/\.readiness-modal-actions/);
});
