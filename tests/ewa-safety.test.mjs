import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EWA_POLICY,
  earnedDaysInPeriod,
  ewaEligibility,
} from '../functions/api/_ewa.js';

test('EWA default policy is fail-closed', () => {
  assert.equal(DEFAULT_EWA_POLICY.enabled, 0);
  const result = ewaEligibility({
    policy: DEFAULT_EWA_POLICY,
    daysWorked: 20,
    tenureMonths: 12,
    tenureDays: 365,
    joinDate: '2025-01-01',
    plafond: 1_000_000,
    openRequest: null,
    paid: false,
    active: true,
  });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /belum diaktifkan/i);
});

test('earned days count weekdays, not calendar dates', () => {
  const result = earnedDaysInPeriod(new Date('2026-08-24T12:00:00Z'));
  assert.equal(result.period, '2026-08');
  assert.equal(result.daysInMonth, 21);
  assert.equal(result.daysWorked, 16);
});

test('earned days never include dates before employee joins', () => {
  const result = earnedDaysInPeriod(
    new Date('2026-08-24T12:00:00Z'),
    '2026-08-20',
  );
  assert.equal(result.daysWorked, 3);
});
