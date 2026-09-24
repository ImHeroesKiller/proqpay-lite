import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('dashboard SLA includes overdue items and keeps them ahead of upcoming deadlines', async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/filter\(\(row\)=>row\.deadline&&row\.days!==null&&row\.days<=30\)/);
  assert.doesNotMatch(source,/row\.days>=0/);
  assert.match(source,/sort\(\(a,b\)=>\(a\.days\?\?0\)-\(b\.days\?\?0\)\)/);
  assert.match(source,/hari terlambat/);
});

test('Open exceptions KPI routes directly to exception workspace', async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/label="Open exceptions"[\s\S]*onClick=\{\(\)=>openContext\('exceptions'\)\}/);
});

test('dashboard pagination clamps itself when refreshed data reduces page count', async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/useEffect\(\(\)=>setPage\(\(value\)=>Math\.min\(value,pageCount\)\),\[pageCount\]\)/);
});
