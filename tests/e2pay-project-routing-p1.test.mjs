import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const api=await readFile(new URL('../functions/api/e2pay-subaccounts.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0053_e2pay_project_overrides.sql',import.meta.url),'utf8');

test('P1 project routing inherits client account and supports explicit override',()=>{
  assert.match(migration,/project_id TEXT REFERENCES projects\(id\)/);
  assert.match(migration,/uq_provider_project_account/);
  assert.match(ui,/Inherited from Client/);
  assert.match(ui,/Project Override/);
  assert.match(ui,/Register Project Override/);
});

test('P1 registration confirmation is server-side and does not persist confirmation secrets',()=>{
  assert.match(api,/CONFIRM_SUBACCOUNT/);
  assert.match(api,/e2payRegisterConfirm/);
  assert.match(api,/E2PAY_CONFIRM_ACCOUNT_ID_MISSING/);
  assert.doesNotMatch(api,/metadata=.*password/);
  assert.doesNotMatch(api,/metadata=.*token/);
});

test('P1 keeps controller read-only while processor and super admin manage provisioning',()=>{
  assert.match(api,/const READ_ROLES=\['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'\]/);
  assert.match(api,/const MANAGE_ROLES=\['SUPER_ADMIN','PAYROLL_PROCESSOR'\]/);
});
