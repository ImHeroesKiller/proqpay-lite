import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { roleHasCapability } from '../shared/authority-matrix.js';

test('Client User and Payroll Processor can access payroll intake capability',()=>{
  assert.equal(roleHasCapability('CLIENT_USER','data-intake'),true);
  assert.equal(roleHasCapability('PAYROLL_PROCESSOR','data-intake'),true);
  assert.equal(roleHasCapability('PAYROLL_CONTROLLER','data-intake'),false);
});

test('payroll intake endpoints allow client user but retain scope guards',async()=>{
  const [setup,intake]=await Promise.all([
    readFile(new URL('../functions/api/payroll-intake-setup.js',import.meta.url),'utf8'),
    readFile(new URL('../functions/api/payroll-intake.js',import.meta.url),'utf8'),
  ]);
  assert.match(setup,/CLIENT_USER/);
  assert.match(intake,/CLIENT_USER/);
  assert.match(intake,/Client scope denied/);
  assert.match(intake,/Project scope denied/);
  assert.match(intake,/Scope denied/);
});

test('Payroll Processor and Controller navigation collapses operational modules into Payroll Workspace',async()=>{
  const [sidebar,router,nav,workspace]=await Promise.all([
    readFile(new URL('../src/components/Sidebar.tsx',import.meta.url),'utf8'),
    readFile(new URL('../src/components/AppWorkspaceRouter.tsx',import.meta.url),'utf8'),
    readFile(new URL('../src/lib/navigation-config.ts',import.meta.url),'utf8'),
    readFile(new URL('../src/components/UnifiedPayrollWorkspace.tsx',import.meta.url),'utf8'),
  ]);
  assert.match(sidebar,/title="Payroll Workspace"/);
  assert.match(router,/UnifiedPayrollWorkspace/);
  assert.match(nav,/operations: "Payroll Workspace"/);
  assert.match(workspace,/Data & Payroll/);
  assert.match(workspace,/Approval & Payment/);
  assert.match(workspace,/Reconcile & Close/);
  assert.match(workspace,/final execution hanya Payroll Controller/);
});

test('Data Intake hands off directly to the unified Payroll Workspace',async()=>{
  const intake=await readFile(new URL('../src/app/data-intake/page.tsx',import.meta.url),'utf8');
  assert.match(intake,/Upload Payroll Data/);
  assert.match(intake,/Buka Payroll Workspace/);
  assert.match(intake,/view=operations/);
});
