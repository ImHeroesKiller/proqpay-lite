import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const verifier=await readFile(new URL('../scripts/verify-production-mfa.mjs',import.meta.url),'utf8');

test('production strong-auth verifier accepts MFA and passkey challenges without mutating enrollment',()=>{
  assert.match(verifier,/MFA_REQUIRED/);
  assert.match(verifier,/MFA_ENROLLMENT_REQUIRED/);
  assert.match(verifier,/PASSKEY_REQUIRED/);
  assert.match(verifier,/response\.status!==428/);
  assert.doesNotMatch(verifier,/security-mfa|security-passkey|ENROLL_START|ENROLL_ACTIVATE/);
  assert.doesNotMatch(verifier,/wrangler|d1 execute|DELETE FROM|UPDATE app_user/i);
});

test('production strong-auth verifier reports which control enforced the challenge',()=>{
  assert.match(verifier,/strongAuthEnforced:true/);
  assert.match(verifier,/mfaEnforced:challenge\.startsWith\('MFA_'\)/);
  assert.match(verifier,/passkeyEnforced:challenge==='PASSKEY_REQUIRED'/);
});
