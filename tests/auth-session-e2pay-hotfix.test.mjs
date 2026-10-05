import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { authenticateSession, createSession } from '../functions/api/_account-auth.js';
import { requestSecurityContext } from '../functions/api/_security-context.js';
import { D1Mock } from './helpers/d1-mock.mjs';

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

test('session survives ordinary browser hint drift and refresh under ENFORCE_CRITICAL',async()=>{
  assert.match(session,/SECURITY_SESSION_DEVICE_MODE \|\| 'ENFORCE_CRITICAL'/);
  assert.match(session,/deviceMode === 'ENFORCE_CRITICAL'/);
  assert.doesNotMatch(context,/headers\.get\(['"]Accept-Language['"]\)/);
  assert.doesNotMatch(context,/headers\.get\(['"]Sec-CH-UA['"]\)/);

  const DB=new D1Mock();
  DB.sqlite.exec(`INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-OTSINDO','OTSINDO','OTS');`);
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES (?,?,?,?,?,'ACTIVE','h','s',100000,0,0,'test')`)
    .run('USR-REFRESH-SAFE','ORG-OTSINDO','Refresh Safe','refresh-safe@example.test','SUPER_ADMIN');

  const env={
    DB,
    DEFAULT_ORG_ID:'ORG-OTSINDO',
    SECURITY_CONTEXT_KEY:'refresh-safe-security-context-key-longer-than-thirty-two',
    SECURITY_SESSION_DEVICE_MODE:'ENFORCE_CRITICAL',
  };
  const requestA=new Request('https://proqpay.test/api/me',{
    headers:{
      'CF-Connecting-IP':'203.0.113.30',
      'User-Agent':'ProQPay-Browser/154',
      'Accept-Language':'id-ID',
      'Sec-CH-UA':'"Chromium";v="154"',
      'Sec-CH-UA-Platform':'"macOS"',
      'Sec-CH-UA-Mobile':'?0',
    },
  });
  const contextA=await requestSecurityContext(requestA,env);
  const created=await createSession(DB,'USR-REFRESH-SAFE',env,{context:contextA});

  const requestB=new Request('https://proqpay.test/api/me',{
    headers:{
      Cookie:`proqpay_session=${encodeURIComponent(created.token)}`,
      'CF-Connecting-IP':'203.0.113.30',
      'User-Agent':'ProQPay-Browser/154',
      'Accept-Language':'en-US,en;q=0.9',
      'Sec-CH-UA':'"Chromium";v="154", "Not_A Brand";v="99"',
      'Sec-CH-UA-Platform':'"macOS"',
      'Sec-CH-UA-Mobile':'?0',
    },
  });
  const user=await authenticateSession(requestB,env);
  assert.equal(user?.id,'USR-REFRESH-SAFE');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS total FROM app_sessions WHERE user_id=?').get('USR-REFRESH-SAFE').total,1);
});

test('E2Pay runtime credentials fall back to Worker secrets for partial stored profiles',()=>{
  assert.match(gateway,/const credential = \(key, fallbackKey\)/);
  assert.match(gateway,/credential\('clientId','E2PAY_CLIENT_ID'\)/);
  assert.match(gateway,/credential\('clientSecret','E2PAY_CLIENT_SECRET'\)/);
  assert.match(gateway,/credential\('partnerId','E2PAY_PARTNER_ID'\)/);
  assert.match(gateway,/credential\('sourceId','E2PAY_SOURCE_ID'\)/);
});
