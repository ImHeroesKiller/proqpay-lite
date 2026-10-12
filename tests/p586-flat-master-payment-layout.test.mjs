import {readGlobalCss} from './helpers/style-sources.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('P5.8.6 Clients & Projects flat master layout keeps all filters, tabs, actions and pagination',async()=>{
 const ui=await read('src/components/DirectoryManager.tsx');
 assert.match(ui,/<h2>Klien & Project<\/h2>/);
 assert.match(ui,/directory-inline-stats/);
 assert.match(ui,/directory-filter-compact/);
 assert.match(ui,/directory-master-flat/);
 assert.doesNotMatch(ui,/UiMetricGrid|UiMetricCard|UiSectionCard|UiFilterBar/);
 for(const feature of ['value={query}','value={statusFilter}','value={projectClientFilter}','Reset','UiTabs','UiPagination','UiDataTableState','directory-entity-card','editClient(client)','editProject(project)'])assert.ok(ui.includes(feature),feature);
});

test('P5.8.6 Payment Instructions has compact filters, inline decisions, flat PI table and compact navigation',async()=>{
 const [workspace,payment]=await Promise.all([read('src/components/UnifiedPayrollWorkspace.tsx'),read('src/components/OperatingWorkspace.tsx')]);
 assert.match(workspace,/payroll-shared-filter-payments/);
 assert.match(workspace,/payroll-stage-nav-compact/);
 assert.match(workspace,/stage==='PAYMENT'\?' payroll-shared-filter-payments':' card'/);
 assert.match(payment,/operations-control-bar-payments/);
 assert.match(payment,/payment-decision-inline/);
 assert.match(payment,/payment-decision-nav-compact/);
 assert.match(payment,/payment-instruction-table-flat/);
 assert.match(payment,/flat=\{phase==='payment'\}/);
 assert.match(payment,/mode==='payments'\?' operations-control-bar-payments':''/);
 assert.match(payment,/displayedPaymentPanel==='PI'\?<Payments phase="payment"/);
 assert.match(payment,/canonicalDecisionKnown\?canonicalDecisionActions:'—'/);
});

test('P5.8.6 mobile and desktop CSS scope prevents cardless styling leaking into other workspaces',async()=>{
 const css=await readGlobalCss();
 for(const scope of ['.directory-inline-stats','.directory-filter-compact','.directory-master-flat','.payroll-stage-nav-compact','.payroll-shared-filter-payments','.operations-control-bar-payments','.payment-decision-inline','.payment-decision-nav-compact','.payment-instruction-table-flat'])assert.ok(css.includes(scope),scope);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.match(css,/.directory-master-flat .directory-entity-card\{border:0;/);
 assert.match(css,/.payment-decision-inline>div\{display:flex;/);
});
