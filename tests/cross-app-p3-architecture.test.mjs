import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_ROLES,
  viewsForRole,
  permissionsForRole,
  roleHasCapability,
  roleCanAction,
} from '../shared/authority-matrix.js';

test('canonical authority matrix exposes only approved roles',()=>{
  assert.deepEqual([...APP_ROLES],[
    'SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER',
  ]);
});

test('canonical authority matrix keeps role navigation aligned with business responsibility',()=>{
  assert.ok(viewsForRole('SUPER_ADMIN').includes('integrations'));
  assert.ok(viewsForRole('SUPER_ADMIN').includes('logs'));
  assert.ok(viewsForRole('PAYROLL_PROCESSOR').includes('payments'));
  assert.ok(viewsForRole('PAYROLL_CONTROLLER').includes('payments'));
  assert.deepEqual([...viewsForRole('CLIENT_USER')],['dashboard','operations','reports']);
  assert.ok(!viewsForRole('CLIENT_USER').includes('payments'));
});

test('canonical role action matrix preserves maker checker and admin boundaries',()=>{
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','payment.execute'),true);
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','payment.approve'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','payment.execute'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','payment.approve'),true);
  assert.equal(roleCanAction('CLIENT_USER','payment.prepare'),false);
  assert.equal(roleCanAction('SUPER_ADMIN','integrations.manage'),true);
  assert.equal(roleCanAction('SUPER_ADMIN','audit.view'),true);
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','audit.view'),false);
});

test('backend permission source remains consistent with semantic actions',()=>{
  assert.ok(permissionsForRole('PAYROLL_PROCESSOR').includes('payroll:write'));
  assert.ok(permissionsForRole('PAYROLL_CONTROLLER').includes('approval:write'));
  assert.ok(permissionsForRole('PAYROLL_CONTROLLER').includes('payment:approve'));
  assert.deepEqual([...permissionsForRole('CLIENT_USER')],['read']);
  assert.equal(roleHasCapability('CLIENT_USER','gateway:execute'),false);
});
