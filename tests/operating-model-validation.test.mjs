import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOperatingAction } from '../functions/api/operating-model-validation.js';

const validPayRun = {
  action: 'CREATE_PAY_RUN',
  clientId: 'CLI-001',
  projectId: 'PRJ-001',
  servicePlanId: 'SP-001',
  period: '2026-08',
  paymentPeriod: '2026-08',
  paymentDate: '2026-08-25',
  runType: 'REGULAR',
  sourceMode: 'MASTER_CURRENT',
};

test('CREATE_PAY_RUN accepts payment date inside selected payment period', () => {
  const result = validateOperatingAction(validPayRun);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('CREATE_PAY_RUN rejects payment date outside selected payment period', () => {
  const result = validateOperatingAction({
    ...validPayRun,
    paymentPeriod: '2026-09',
    paymentDate: '2026-08-25',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('paymentDate harus berada pada paymentPeriod yang dipilih'));
});
