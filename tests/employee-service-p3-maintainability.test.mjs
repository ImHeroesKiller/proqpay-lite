import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { EMPLOYEE_SERVICES_CONTRACT_VERSION, EMPLOYEE_SERVICES_EWA_STATUSES } from '../functions/api/_employee-contract.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employee Services P3: contract manifest matches runtime version and lifecycle',async()=>{
  const manifest=JSON.parse(await read('employee-services-contract.json'));
  assert.equal(manifest.version,EMPLOYEE_SERVICES_CONTRACT_VERSION);
  assert.deepEqual(manifest.ewaStatuses,EMPLOYEE_SERVICES_EWA_STATUSES);
});

test('Employee Services P3: admin lifecycle UI consumes shared model instead of duplicating status labels',async()=>{
  const inbox=await read('src/components/EwaInbox.tsx');
  const shared=await read('src/lib/employee-services.ts');
  const primitives=await read('src/components/employee-services/EwaLifecycle.tsx');
  assert.match(inbox,/EWA_STATUSES/);
  assert.match(inbox,/ewaMeta/);
  assert.match(inbox,/EwaDetailPanel/);
  assert.match(inbox,/EwaStatusBadge/);
  assert.doesNotMatch(inbox,/const LABEL/);
  assert.match(shared,/EWA_LIFECYCLE/);
  assert.match(primitives,/Tahap/);
  assert.match(primitives,/dari 5/);
});

test('Employee Services P3: search-heavy admin views debounce network requests',async()=>{
  const hook=await read('src/hooks/useDebouncedValue.ts');
  const inbox=await read('src/components/EwaInbox.tsx');
  const audit=await read('src/components/SystemLogs.tsx');
  assert.match(hook,/setTimeout/);
  assert.match(inbox,/qDebounced/);
  assert.match(audit,/qDebounced/);
});

test('Employee Services P3: accessibility semantics remain explicit',async()=>{
  const inbox=await read('src/components/EwaInbox.tsx');
  const primitives=await read('src/components/employee-services/EwaLifecycle.tsx');
  const states=await read('src/components/employee-services/OperationalState.tsx');
  assert.match(inbox,/aria-label="Filter status"/);
  assert.match(inbox,/aria-live="polite"/);
  assert.match(primitives,/role="dialog"/);
  assert.match(primitives,/aria-labelledby/);
  assert.match(states,/role="alert"/);
});
