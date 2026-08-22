import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDirectoryAction } from '../functions/api/client-projects-validation.js';

test('client directory accepts controlled client and project payloads', () => {
  assert.equal(validateDirectoryAction({
    action: 'CREATE_CLIENT', name: 'PT Saka Gemilang', website: 'https://saka.example',
    industry: 'Outsourcing', contactName: 'Rani', contactEmail: 'rani@saka.example', status: 'ACTIVE',
  }).ok, true);
  assert.equal(validateDirectoryAction({
    action: 'CREATE_PROJECT', name: 'Payroll Nasional', clientId: 'CLI-039', serviceType: 'Payroll Management', tier:'TIER_2_MANAGED_PAYROLL', tierEffectiveFrom:'2026-08-15',
  }).ok, true);
  assert.equal(validateDirectoryAction({ action: 'CREATE_CLIENT', code: 'iap', name: 'PT Indomarco Adi Prima' }).ok, true);
  assert.equal(validateDirectoryAction({
    action: 'CREATE_PROJECT', code: 'IAP-PAYROLL', name: 'Payroll Nasional',
    clientId: 'CLI-039', startDate: '2026-08-10',
  }).ok, true);
  assert.equal(validateDirectoryAction({
    action: 'UPDATE_PROJECT', id: 'PRJ-1', code: 'IAP-PAYROLL', name: 'Payroll Nasional',
    clientId: 'CLI-039', status: 'ON_HOLD',
  }).ok, true);
});

test('client directory rejects unsafe codes and unscoped projects', () => {
  assert.equal(validateDirectoryAction({ action: 'CREATE_CLIENT', code: '../bad', name: 'Client' }).ok, false);
  assert.equal(validateDirectoryAction({ action: 'CREATE_CLIENT', name: 'Client', website: 'http://internal.local' }).ok, false);
  assert.equal(validateDirectoryAction({ action: 'CREATE_PROJECT', code: 'PRJ-1', name: 'Project' }).ok, false);
  assert.equal(validateDirectoryAction({action:'CREATE_PROJECT',name:'Project',clientId:'CLI-1',tier:'TIER_9'}).ok,false);
  assert.equal(validateDirectoryAction({action:'CREATE_CLIENT',name:'Client',taxStatus:'PKP',billingTaxRate:101}).ok,false);
});
