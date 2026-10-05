import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mfa=await readFile(new URL('../functions/api/_mfa.js',import.meta.url),'utf8');
const mfaApi=await readFile(new URL('../functions/api/security-mfa.js',import.meta.url),'utf8');
const authUi=await readFile(new URL('../src/components/AuthViews.tsx',import.meta.url),'utf8');
const session=await readFile(new URL('../functions/api/_account-auth.js',import.meta.url),'utf8');
const context=await readFile(new URL('../functions/api/_security-context.js',import.meta.url),'utf8');
const gateway=await readFile(new URL('../functions/api/payment-gateway-settings-store.js',import.meta.url),'utf8');

test('active MFA enrollment is idempotent and never rotates the existing secret',()=>{
  assert.match(mfa,/current\?\.status === 'ACTIVE'/);
  assert.match(mfaApi,/MFA_ALREADY_ACTIVE/);
  assert.match(authUi,/MFA sudah terdaftar/);
});

test('session survives ordinary browser hint drift and refresh',()=>{
  assert.match(session,/deviceMode === 'ENFORCE_STRICT'/);
  assert.match(session,/SECURITY_SESSION_DEVICE_MODE \|\| 'AUDIT'/);
  assert.doesNotMatch(context,/Accept-Language/);
  assert.doesNotMatch(context,/Sec-CH-UA'\)/);
});

test('E2Pay runtime credentials fall back to Worker secrets for partial stored profiles',()=>{
  assert.match(gateway,/const credential = \(key, fallbackKey\)/);
  assert.match(gateway,/credential\('clientId','E2PAY_CLIENT_ID'\)/);
  assert.match(gateway,/credential\('clientSecret','E2PAY_CLIENT_SECRET'\)/);
  assert.match(gateway,/credential\('partnerId','E2PAY_PARTNER_ID'\)/);
  assert.match(gateway,/credential\('sourceId','E2PAY_SOURCE_ID'\)/);
});
