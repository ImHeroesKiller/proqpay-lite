import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Billing P3: typed UI contracts centralize Billing, Invoice, AR and modal state',async()=>{
  const source=await read('src/lib/billing-ui.ts');
  assert.match(source,/export type BillingData/);
  assert.match(source,/export type InvoiceRecord/);
  assert.match(source,/export type ArRecord/);
  assert.match(source,/export type BillingModalKind/);
  assert.match(source,/export function billingPermission/);
  assert.match(source,/export function arControlSummary/);
  assert.match(source,/export function billingDateLabel/);
});

test('Billing P3: native prompt and confirm are replaced by structured workflow dialogs',async()=>{
  const source=await read('src/components/BillingWorkspace.tsx');
  assert.doesNotMatch(source,/window\.prompt/);
  assert.doesNotMatch(source,/window\.confirm/);
  assert.match(source,/kind: "revise"/);
  assert.match(source,/kind: "follow-up"/);
  assert.match(source,/kind: "close"/);
  assert.match(source,/ActionNoteForm/);
  assert.match(source,/FollowUpForm/);
  assert.match(source,/CloseConfirmation/);
  assert.match(source,/Tandai sebagai disputed/);
  assert.match(source,/Outstanding AR tetap aktif sampai pelunasan/);
});

test('Billing P3: workspace consumes typed helpers instead of duplicating control and permission logic',async()=>{
  const source=await read('src/components/BillingWorkspace.tsx');
  assert.match(source,/billingPermission\(actor, "billing:prepare"/);
  assert.match(source,/billingPermission\(actor, "billing:approve"/);
  assert.match(source,/billingPermission\(actor, "ar:write"/);
  assert.match(source,/arControlSummary\(rows as ArRecord\[\]\)/);
  assert.match(source,/const date = billingDateLabel/);
  assert.match(source,/billingModalTitle\(modal\.kind\)/);
});

test('Billing P3: dialog accessibility and mobile polish hooks are present',async()=>{
  const workspace=await read('src/components/BillingWorkspace.tsx');
  const css=await read('src/app/polish.css');
  assert.match(workspace,/className="billing-modal-backdrop"/);
  assert.match(workspace,/className="card billing-modal"/);
  assert.match(workspace,/role="dialog"/);
  assert.match(workspace,/aria-modal="true"/);
  assert.match(workspace,/className="billing-tabs"/);
  assert.match(css,/Billing & AR P3/);
  assert.match(css,/\.billing-confirmation-summary/);
  assert.match(css,/\.billing-modal-backdrop/);
  assert.match(css,/@media \(max-width:760px\)[\s\S]*\.billing-modal/);
});
