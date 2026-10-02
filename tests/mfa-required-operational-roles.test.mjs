import assert from 'node:assert/strict';
import test from 'node:test';
import { isCriticalMfaRole, isRequiredMfaRole } from '../functions/api/_security-context.js';

test('operational MFA policy requires TOTP for Super Admin, Payroll Controller and Payroll Processor',()=>{
  assert.equal(isRequiredMfaRole('SUPER_ADMIN'),true);
  assert.equal(isRequiredMfaRole('PAYROLL_CONTROLLER'),true);
  assert.equal(isRequiredMfaRole('PAYROLL_PROCESSOR'),true);
  assert.equal(isRequiredMfaRole('CLIENT_USER'),false);
});

test('passkey privileged scope remains narrower than required TOTP MFA scope',()=>{
  assert.equal(isCriticalMfaRole('SUPER_ADMIN'),true);
  assert.equal(isCriticalMfaRole('PAYROLL_CONTROLLER'),true);
  assert.equal(isCriticalMfaRole('PAYROLL_PROCESSOR'),false);
});

test('login and enrollment wire required MFA roles without widening passkey scope',async()=>{
  const { readFile }=await import('node:fs/promises');
  const login=await readFile(new URL('../functions/api/login.js',import.meta.url),'utf8');
  const mfa=await readFile(new URL('../functions/api/security-mfa.js',import.meta.url),'utf8');
  const passkey=await readFile(new URL('../functions/api/security-passkey.js',import.meta.url),'utf8');
  assert.match(login,/isRequiredMfaRole\(user\.role\)/);
  assert.match(login,/isCriticalMfaRole\(user\.role\)/);
  assert.match(mfa,/isRequiredMfaRole\(user\.role\)/);
  assert.match(mfa,/required:Boolean\(isRequiredMfaRole\(actor\.role\)\)/);
  assert.match(passkey,/const PRIVILEGED=\['SUPER_ADMIN','PAYROLL_CONTROLLER'\]/);
});