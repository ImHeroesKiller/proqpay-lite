import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('dashboard replaces deadlines with client availability and visible payment blocks',async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/Available Saldo per Klien/);
  assert.match(source,/row.reasons.map/);
  assert.doesNotMatch(source,/Deadline & SLA|UPCOMING 30 DAYS/);
});

test('Open exceptions KPI routes directly to exception workspace', async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/label="Open exceptions"[\s\S]*onClick=\{\(\)=>openContext\('exceptions'\)\}/);
});

test('dashboard pagination clamps itself when refreshed data reduces page count', async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/useEffect\(\(\)=>setPage\(\(value\)=>Math\.min\(value,pageCount\)\),\[pageCount\]\)/);
});
