import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Phase 4 limits client navigation to Home Payroll and Documents', async()=>{
  const sidebar=await read('src/components/Sidebar.tsx');
  assert.match(sidebar,/CLIENT_USER: \["dashboard", "operations", "reports"\]/);
  assert.match(sidebar,/const clientExperience = role === "CLIENT_USER"/);
  assert.match(sidebar,/title="Home"/);
  assert.match(sidebar,/title="Payroll"/);
  assert.match(sidebar,/title="Documents"/);
  assert.doesNotMatch(sidebar,/CLIENT_USER: \[[^\]]*"payments"/);
  assert.doesNotMatch(sidebar,/CLIENT_USER: \[[^\]]*"billing"/);
  assert.doesNotMatch(sidebar,/CLIENT_USER: \[[^\]]*"exceptions"/);
});

test('legacy client routes normalize into the three Phase 4 workspaces', async()=>{
  const page=await read('src/app/page.tsx');
  assert.match(page,/if \(view === 'exceptions' \|\| view === 'payments'\) return 'operations'/);
  assert.match(page,/if \(view === 'billing'\) return 'reports'/);
  assert.match(page,/actor\.role === 'CLIENT_USER'\s*\? <ClientHome/);
  assert.match(page,/actor\.role === 'CLIENT_USER' \? <ClientDocumentsWorkspace/);
});

test('Client Home exposes business-facing priorities without adding approval mutations', async()=>{
  const home=await read('src/components/ClientHome.tsx');
  assert.match(home,/Needs Your Attention/);
  assert.match(home,/For Approval/);
  assert.match(home,/Payment Status/);
  assert.match(home,/Documents/);
  assert.match(home,/CLIENT_APPROVAL_PENDING|category==='APPROVAL'/);
  assert.doesNotMatch(home,/executeOperatingAction/);
  assert.doesNotMatch(home,/executeOperatingAction|TRANSITION_SUBMISSION|ADVANCE_PAY_RUN/);
});

test('client Payroll combines status corrections and payment status with business stages', async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/const clientExperience = role === 'CLIENT_USER'/);
  assert.match(source,/const simplifiedWorkspace = simplifiedInternal \|\| clientExperience/);
  assert.match(source,/Kirim data payroll/);
  assert.match(source,/clientCorrections=openExceptions\.filter/);
  assert.match(source,/Perbaikan Payroll/);
  assert.match(source,/paymentBusinessLabel\(instruction\.status\)/);
  assert.match(source,/role==='CLIENT_USER'\?\['Payroll','Stage','Net \/ THP','Payment','Next'\]/);
  assert.match(source,/<small style=\{small\}>\{business\.description\}<\/small>/);
  assert.match(source,/role!=='CLIENT_USER'\?<div className="pay-run-lifecycle"/);
});

test('client Documents combines invoices with a reduced report set', async()=>{
  const docs=await read('src/components/ClientDocumentsWorkspace.tsx');
  const reports=await read('src/components/ReportsWorkspace.tsx');
  assert.match(docs,/Documents & Reports/);
  assert.match(docs,/Invoice & Tax Documents/);
  assert.match(docs,/<ReportsWorkspace clientMode/);
  assert.match(reports,/clientMode \? \['payments','register','payslips'\]/);
  assert.match(reports,/!clientMode \? <PayrollSourceUpload/);
});

test('Phase 4 preserves backend client scoping for documents and reports', async()=>{
  const billing=await read('functions/api/billing.js');
  const reports=await read('functions/api/payroll-reports.js');
  assert.match(billing,/function clientFilter\(actor,column\)/);
  assert.match(billing,/actor\.role==='CLIENT_USER'/);
  assert.match(reports,/function scopeSql\(actor, env/);
  assert.match(reports,/if \(actor\.role === 'CLIENT_USER'\)/);
});
