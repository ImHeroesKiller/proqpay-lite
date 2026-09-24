import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('dashboard P3 removes repetitive action copy and adds contextual empty states',async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/aria-label=\{\`\$\{item\.action\} untuk \$\{item\.client\}\`\}/);
  assert.doesNotMatch(source,/\{item\.title\} · \{item\.detail\}/);
  assert.match(source,/Tidak ada tindakan sesuai filter aktif/);
  assert.match(source,/Belum ada payroll untuk periode ini/);
  assert.match(source,/Coba reset filter atau ubah periode/);
});

test('dashboard P3 pagination controls have accessible names',async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/aria-label="Halaman sebelumnya"/);
  assert.match(source,/aria-label="Halaman berikutnya"/);
});

test('dashboard P3 readability polish raises microcopy size and touch targets',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/Dashboard P3 readability and density polish/);
  assert.match(css,/\.action-list > button,[\s\S]*min-height: 48px/);
  assert.match(css,/\.control-pagination \.btn \{[\s\S]*min-height: 36px/);
  assert.match(css,/\.control-empty \{[\s\S]*border: 1px dashed var\(--border\)/);
  assert.match(css,/\.portfolio-table td \{[\s\S]*padding: 11px 12px/);
});
