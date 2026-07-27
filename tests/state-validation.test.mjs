import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBusinessState } from '../functions/api/state-validation.js';

test('accepts a bounded business state', () => {
  const result = validateBusinessState({
    payrolls: [{ id: 'PAY202607', period: '2026-07', status: 'CALCULATED' }],
    invoices: [{ id: 'INV202607-01', period: '2026-07' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.payrolls.length, 1);
});

test('rejects invalid ids and periods', () => {
  assert.equal(validateBusinessState({ payrolls: [{ id: '../bad', period: '2026-13' }] }).ok, false);
  assert.equal(validateBusinessState({ payrolls: [{ id: 'PAY1', period: 'July' }] }).ok, false);
});

test('ignores unknown top-level state fields', () => {
  const result = validateBusinessState({ payrolls: [], secret: 'not persisted' });
  assert.equal(result.ok, true);
  assert.equal('secret' in result.state, false);
});
