import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync('functions/api/e2pay-subaccounts.js','utf8');
const ui=fs.readFileSync('src/components/DirectoryManager.tsx','utf8');
const client=fs.readFileSync('src/lib/e2pay-api.ts','utf8');

test('P0 allows Super Admin and Payroll Processor to manage client E2Pay registration',()=>{
  assert.match(api,/MANAGE_ROLES=\['SUPER_ADMIN','PAYROLL_PROCESSOR'\]/);
  assert.match(api,/action==='REGISTER_SUBACCOUNT'/);
  assert.match(api,/e2payHostAuthorize/);
  assert.match(api,/e2payRegisterRequest/);
});

test('P0 registration is owned by Client UI rather than requiring raw provider IDs',()=>{
  assert.match(ui,/Payment & Disbursement/);
  assert.match(ui,/Register E2Pay Sub-Client/);
  assert.match(ui,/registerE2PaySubAccount/);
  assert.match(client,/action:'REGISTER_SUBACCOUNT'/);
});

test('P0 preserves controller-only payment execution boundary',()=>{
  assert.match(api,/const READ_ROLES=\['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'\]/);
  assert.match(api,/const MANAGE_ROLES=\['SUPER_ADMIN','PAYROLL_PROCESSOR'\]/);
  assert.doesNotMatch(api,/const MANAGE_ROLES=.*PAYROLL_CONTROLLER/);
  assert.doesNotMatch(ui,/canManageE2Pay\s*=.*PAYROLL_CONTROLLER/);
});
