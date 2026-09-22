import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Phase 3 removes redundant static role card for Processor and Controller dashboards', async()=>{
  const page=await read('src/app/page.tsx');
  assert.match(page,/const simplifiedInternal = \['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'\]\.includes\(actor\.role\)/);
  assert.match(page,/!simplifiedInternal \? <RoleDashboard/);
  assert.match(page,/<PayrollControlTower actor=\{actor\}/);
});

test('internal navigation uses simple business language and hides secondary employee-portal admin menus', async()=>{
  const sidebar=await read('src/components/Sidebar.tsx');
  assert.match(sidebar,/simplifiedInternal \? "Work" : "Workflow"/);
  assert.match(sidebar,/simplifiedInternal \? "Issues" : "Data Readiness"/);
  assert.match(sidebar,/simplifiedInternal \? "Payroll" : "Pay Runs"/);
  assert.match(sidebar,/simplifiedInternal\s*\? "Payments"/);
  assert.match(sidebar,/simplifiedInternal \? "Close & Billing" : "Billing & AR"/);
  assert.match(sidebar,/simplifiedInternal \? "Reference & Reports" : "People & Insight"/);
  assert.match(sidebar,/role === "SUPER_ADMIN" && \(allowed\.has\("ewa"\)/);
});

test('Control Tower becomes My Workspace with business-stage filtering for internal roles', async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/control-tower-simple/);
  assert.match(source,/MY WORKSPACE/);
  assert.match(source,/Payroll Workspace/);
  assert.match(source,/Approval Workspace/);
  assert.match(source,/stage==='ALL'\|\|row\.business\.stage===stage/);
  assert.match(source,/My work/);
  assert.match(source,/ALL PAYROLL/);
  assert.match(source,/Monitor only/);
  assert.match(source,/category:String\(row\.nextAction\.category/);
  assert.match(source,/item\.category==='APPROVAL'/);
});

test('internal payroll workspace filters and displays business stages instead of technical submission states', async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/simplifiedInternal && mode === 'payruns'/);
  assert.match(source,/PAYROLL_BUSINESS_STAGE_ORDER/);
  assert.match(source,/BUSINESS_STAGE_META\[state as keyof typeof BUSINESS_STAGE_META\]/);
  assert.match(source,/headers=\{simplified\?\['Klien \/ Periode','Stage','Net \/ THP','Next action'\]/);
  assert.match(source,/business\.label/);
  assert.match(source,/nextAction\.actionable\?'Action required':'Monitor only'/);
});

test('internal payment workspace uses business labels while technical PI states remain available in detail workflow', async()=>{
  const source=await read('src/components/OperatingWorkspace.tsx');
  assert.match(source,/function paymentBusinessLabel/);
  assert.match(source,/PAYMENT_APPROVAL_PENDING:'For Approval'/);
  assert.match(source,/APPROVED_FOR_PAYMENT:'Ready to Pay'/);
  assert.match(source,/DISBURSEMENT_PROCESSING:'Processing'/);
  assert.match(source,/PROOF_UPLOADED:'Reconcile'/);
  assert.match(source,/REVISION_REQUIRED:'Revision Required'/);
  assert.match(source,/simplified\?paymentBusinessLabel\(r\.status\):r\.status/);
  assert.match(source,/detail\.paymentInstruction\.status === 'PAYMENT_APPROVAL_PENDING'/);
});

test('header labels and work alerts are role-owned for Processor and Controller', async()=>{
  const source=await read('src/components/AppHeader.tsx');
  assert.match(source,/operations:"Payroll"/);
  assert.match(source,/exceptions:"Issues"/);
  assert.match(source,/payments:"Payments"/);
  assert.match(source,/billing:"Close & Billing"/);
  assert.match(source,/actor\.role === "PAYROLL_PROCESSOR"/);
  assert.match(source,/actor\.role === "PAYROLL_CONTROLLER"/);
  assert.match(source,/row\.status === "PAYMENT_APPROVAL_PENDING"/);
  assert.match(source,/No action required/);
});
