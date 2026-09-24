import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('dashboard P2 uses business-stage filtering instead of technical status filtering',async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/Workflow stage/);
  assert.match(source,/row\.business\.stage===stage/);
  assert.doesNotMatch(source,/const \[status,setStatus\]/);
  assert.doesNotMatch(source,/>Status<\/span>/);
});

test('dashboard P2 keeps data visible during manual refresh',async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/const \[refreshing,setRefreshing\] = useState\(false\)/);
  assert.match(source,/void load\(true\)/);
  assert.match(source,/disabled=\{refreshing\}/);
  assert.match(source,/aria-busy=\{loading\|\|refreshing\}/);
});

test('dashboard P2 routes attention and reconciliation to canonical workspaces',async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/const attentionRuns=visible\.filter/);
  assert.match(source,/label="Need attention" value=\{String\(attentionRuns\)\}/);
  assert.match(source,/label="Paid & matched"[\s\S]*openContext\('billing',undefined,'CLOSE'\)/);
});

test('dashboard P2 removes redundant administrative command center from dashboard',async()=>{
  const page=await read('src/app/page.tsx');
  assert.doesNotMatch(page,/RoleDashboard/);
  assert.match(page,/: <PayrollControlTower actor=\{actor\} period=\{period\} onNavigate=\{navigate\} \/>/);
});

test('dashboard P2 desktop pipeline is the canonical five-stage lifecycle',async()=>{
  const css=await read('src/app/polish.css');
  assert.match(css,/\.pipeline-grid \{[\s\S]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
});
