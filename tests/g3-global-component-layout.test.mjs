import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const require=createRequire(import.meta.url);
async function importedPrimitive(){
 const code=ts.transpileModule(await read('src/components/layout/WorkspacePrimitives.tsx'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText;
 const exports={};new Function('exports','require',code)(exports,require);return exports;
}

test('G3 shell frame preserves G2 1180px layout and React tree without extra cards',async()=>{
 const ui=await importedPrimitive();
 const html=renderToStaticMarkup(React.createElement(ui.WorkspaceFrame,null,React.createElement('main',null,'Hello')));
 assert.match(html,/class="app-view-transition"/);
 assert.match(html,/max-width:1180px;margin:0 auto/);
 assert.match(html,/<main>Hello<\/main>/);
 assert.doesNotMatch(html,/card|role="dialog"/);
});

test('G3 shared headings preserve semantics for master, employee and payroll workspaces',async()=>{
 const ui=await importedPrimitive();
 const heading=ui.WorkspaceTitle;
 const client=renderToStaticMarkup(React.createElement(heading,{title:'Klien & Project',description:'Identitas, relasi akun, dan konteks layanan dalam satu master data.',level:'h2'}));
 assert.match(client,/<h2>Klien &amp; Project<\/h2>/);
 assert.match(client,/Identitas, relasi akun/);
 assert.doesNotMatch(client,/card/);
 const payroll=renderToStaticMarkup(React.createElement(heading,{eyebrow:'END-TO-END PAYROLL',title:'Payroll Workspace'}));
 assert.match(payroll,/class="page-eyebrow"/);
 assert.match(payroll,/<h1>Payroll Workspace<\/h1>/);
});

test('G3 compact directory filters retain semantic search container and no decorative card',async()=>{
 const ui=await importedPrimitive();
 const html=renderToStaticMarkup(React.createElement(ui.CompactFilterSurface,{label:'Filter klien dan project',className:'directory-filter-bar directory-filter-compact'},React.createElement('label',null,'Cari')));
 assert.match(html,/role="search" aria-label="Filter klien dan project"/);
 assert.match(html,/class="ui-filter-grid"/);
 assert.match(html,/directory-filter-compact/);
 assert.doesNotMatch(html,/\bcard\b/);
});

test('G3 inline summary supports cardless directory and PI decision metrics with original CSS children',async()=>{
 const ui=await importedPrimitive();
 const strip=renderToStaticMarkup(React.createElement(ui.InlineSummary,{label:'Ringkasan master data',className:'directory-inline-stats',items:[{value:2,label:'klien aktif'},{value:8,label:'project aktif'}]}));
 assert.match(strip,/<span><strong>2<\/strong> klien aktif<\/span>/);
 assert.match(strip,/<span><strong>8<\/strong> project aktif<\/span>/);
 const payment=renderToStaticMarkup(React.createElement(ui.InlineSummary,{variant:'decision',label:'Ringkasan keputusan pembayaran',className:'payment-decision-metrics payment-decision-inline',items:[{label:'Menunggu approval PI',value:3,note:'Maker → Controller'},{label:'Canonical DR membutuhkan aksi',value:'—',note:'Belum terverifikasi'}]}));
 assert.match(payment,/<div><span>Menunggu approval PI<\/span><strong>3<\/strong><small>Maker → Controller<\/small><\/div>/);
 assert.match(payment,/payment-decision-inline/);
 assert.doesNotMatch(payment,/ui-metric-card/);
});

test('G3 Billing view helpers extracted without changing financial authority and modal semantics',async()=>{
 const [billing,primitive,shared,router]=await Promise.all([
  read('src/components/BillingWorkspace.tsx'),read('src/components/billing/BillingViewPrimitives.tsx'),read('src/components/ui/UnifiedSystem.tsx'),read('src/components/AppWorkspaceRouter.tsx'),
 ]);
 assert.match(billing,/billingPermission\(actor, "billing:prepare"/);
 assert.match(billing,/billingPermission\(actor, "billing:approve"/);
 assert.match(billing,/billingPermission\(actor, "ar:write"/);
 assert.match(billing,/from '\@\/components\/billing\/BillingViewPrimitives'/);
 assert.match(primitive,/export function Modal/);
 assert.match(primitive,/UiModalShell title=\{title\} onClose=\{close\} className="billing-modal"/);
 assert.match(primitive,/export function Badge/);
 assert.match(primitive,/export function Field/);
 assert.match(shared,/activeModalStack\.at\(-1\)===dialog/);
 assert.match(shared,/aria-labelledby=\{headingId\}/);
 assert.match(shared,/previouslyFocused\?\.isConnected/);
 assert.match(shared,/event\.key!=='Tab'/);
 assert.match(router,/return <WorkspaceFrame key=\{view\}>/);
 assert.match(router,/ModuleErrorBoundary/);
 assert.match(router,/\['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'\]/);
});
