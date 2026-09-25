import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Employee Services UI P3 centralizes admin visual primitives',async()=>{
  const layout=await read('src/app/layout.tsx');
  const styles=await read('src/app/employee-services.css');
  const inbox=await read('src/components/EwaInbox.tsx');
  const audit=await read('src/components/PortalAudit.tsx');
  assert.match(layout,/employee-services\.css/);
  assert.match(styles,/\.es-table/);
  assert.match(styles,/\.es-drawer/);
  assert.match(styles,/\.es-modal/);
  assert.match(inbox,/es-sticky-left/);
  assert.match(audit,/es-table-wrap/);
  assert.doesNotMatch(inbox,/<style>/);
  assert.doesNotMatch(audit,/<style>/);
});

test('Employee Services UI P3 reuses drawer and modal primitives across lifecycle flows',async()=>{
  const lifecycle=await read('src/components/employee-services/EwaLifecycle.tsx');
  const dialog=await read('src/components/employee-services/DisbursementDialog.tsx');
  assert.match(lifecycle,/es-drawer-backdrop/);
  assert.match(lifecycle,/es-drawer/);
  assert.match(dialog,/es-modal-backdrop/);
  assert.match(dialog,/es-modal/);
  assert.match(dialog,/es-form/);
});

test('Employee Services UI P3 reduces Portal Configuration inline style infrastructure',async()=>{
  const settings=await read('src/components/PortalSettings.tsx');
  const styles=await read('src/app/employee-services.css');
  assert.doesNotMatch(settings,/CSSProperties/);
  assert.doesNotMatch(settings,/const field/);
  assert.match(settings,/portal-config-grid/);
  assert.match(settings,/portal-config-savebar/);
  assert.match(settings,/className="es-field"/);
  assert.match(styles,/\.portal-config-grid/);
  assert.match(styles,/\.portal-config-savebar/);
});

test('Employee Services UI P3 includes reduced-motion and responsive visual safeguards',async()=>{
  const styles=await read('src/app/employee-services.css');
  assert.match(styles,/prefers-reduced-motion/);
  assert.match(styles,/@media\(max-width:760px\)/);
  assert.match(styles,/@media\(max-width:640px\)/);
});
