import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employee Service EWA inbox keeps pending summary independent from status filter',async()=>{
  const api=await read('functions/api/ewa.js');
  assert.match(api,/SUM\(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END\) AS pending/);
  assert.match(api,/COUNT\(\*\) AS total/);
  assert.doesNotMatch(api,/const pending = rows\.filter/);
});

test('Employee Service EWA inbox exposes cancelled lifecycle records',async()=>{
  const ui=await read('src/components/EwaInbox.tsx');
  assert.match(ui,/"CANCELLED"/);
});
