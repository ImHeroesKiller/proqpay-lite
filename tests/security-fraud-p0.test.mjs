import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createSession } from '../functions/api/_account-auth.js';
import { prepareEmployeeBankAccount, revealEmployeeBankAccount, employeeBankStorageValue } from '../functions/api/_employee-bank-security.js';
import { actorFraudDecision, paymentLimitDecision } from '../functions/api/_fraud-controls.js';
import { fraudValueHash } from '../functions/api/_security-context.js';
import '../functions/api/_mfa.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const env={
  PI_ENCRYPTION_KEY:'security-p0-test-key-that-is-definitely-longer-than-32-characters',
  SECURITY_CONTEXT_KEY:'security-context-test-key-that-is-definitely-longer-than-32',
  SECURITY_MFA_KEY:'security-mfa-test-key-that-is-definitely-longer-than-32-chars',
  DEFAULT_ORG_ID:'ORG-OTSINDO',
};

test('P0 security schema includes MFA, fraud, encrypted-bank and payment evidence controls',()=>{
  const DB=new D1Mock();
  const tables=new Set(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row)=>row.name));
  for(const name of ['app_user_mfa','fraud_blocklist','payment_security_limits']){
    assert.ok(tables.has(name),`missing ${name}`);
  }
  const bankColumns=new Set(DB.sqlite.prepare("PRAGMA table_info(employee_bank_accounts)").all().map((row)=>row.name));
  for(const name of ['account_ciphertext','account_iv','account_last4','account_fingerprint','encrypted_at']){
    assert.ok(bankColumns.has(name),`missing employee_bank_accounts.${name}`);
  }
  const sessionColumns=new Set(DB.sqlite.prepare("PRAGMA table_info(app_sessions)").all().map((row)=>row.name));
  for(const name of ['mfa_verified_at','ip_hash','device_hash']) assert.ok(sessionColumns.has(name),`missing app_sessions.${name}`);
  const transactionColumns=new Set(DB.sqlite.prepare("PRAGMA table_info(payment_gateway_transactions)").all().map((row)=>row.name));
  for(const name of ['actor_user_id','actor_ip_hash','actor_device_hash','mfa_verified_at','risk_decision_json']){
    assert.ok(transactionColumns.has(name),`missing payment_gateway_transactions.${name}`);
  }
});

test('P0 employee bank helper encrypts full account and compatibility column stores last4 only',async()=>{
  const secured=await prepareEmployeeBankAccount('1234 5678 9012',env);
  assert.equal(secured.last4,'9012');
  assert.ok(secured.ciphertext);
  assert.ok(secured.iv);
  assert.notEqual(secured.ciphertext,'123456789012');
  const stored=employeeBankStorageValue(secured);
  assert.equal(stored,'ENC:9012');
  assert.equal(stored.includes('12345678'),false);
  const revealed=await revealEmployeeBankAccount({
    account_no:stored,
    account_ciphertext:secured.ciphertext,
    account_iv:secured.iv,
  },env);
  assert.equal(revealed,'123456789012');
});

test('P0 session persists MFA and hashed request context evidence',async()=>{
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-OTSINDO','OTSINDO','OTS');
    INSERT INTO app_users
      (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES('USR-P0','ORG-OTSINDO','P0 Controller','p0.controller@example.test','PAYROLL_CONTROLLER','ACTIVE','h','s',100000,0,1,'test');
  `);
  const session=await createSession(DB,'USR-P0',env,{
    mfaVerifiedAt:'2026-09-29T04:00:00.000Z',
    context:{ipHash:'ip-hash',deviceHash:'device-hash'},
  });
  assert.ok(session.cookie.includes('HttpOnly'));
  const row=DB.sqlite.prepare('SELECT mfa_verified_at,ip_hash,device_hash FROM app_sessions WHERE user_id=?').get('USR-P0');
  assert.equal(row.mfa_verified_at,'2026-09-29T04:00:00.000Z');
  assert.equal(row.ip_hash,'ip-hash');
  assert.equal(row.device_hash,'device-hash');
});

test('P0 fraud blocklist denies blocked actor without storing raw email',async()=>{
  const DB=new D1Mock();
  const email='blocked.person@example.test';
  const hash=await fraudValueHash('EMAIL',email,env);
  DB.sqlite.prepare(`INSERT INTO fraud_blocklist
    (id,org_id,block_type,value_hash,reason,status,created_by)
    VALUES('FBL-P0','ORG-OTSINDO','EMAIL',?,'confirmed fraud','ACTIVE','test')`).run(hash);
  const decision=await actorFraudDecision(DB,'ORG-OTSINDO',{id:'USR-X',email},env);
  assert.equal(decision.blocked,true);
  assert.equal(decision.code,'FRAUD_BLOCK_EMAIL');
  const raw=DB.sqlite.prepare('SELECT value_hash FROM fraud_blocklist WHERE id=?').get('FBL-P0').value_hash;
  assert.notEqual(raw,email);
  assert.equal(raw.length,64);
});

test('P0 payment limit engine blocks amount and recipient thresholds',async()=>{
  const DB=new D1Mock();
  DB.sqlite.prepare(`INSERT INTO payment_security_limits
    (org_id,max_single_amount,max_daily_amount,max_daily_executions,max_recipients,step_up_window_seconds)
    VALUES('ORG-OTSINDO',1000000,5000000,10,5,600)`).run();
  let decision=await paymentLimitDecision(DB,'ORG-OTSINDO',{expected_total:1500000,recipient_count:2},{isNewExecution:true});
  assert.equal(decision.blocked,true);
  assert.equal(decision.code,'PAYMENT_LIMIT_SINGLE_EXCEEDED');
  decision=await paymentLimitDecision(DB,'ORG-OTSINDO',{expected_total:500000,recipient_count:6},{isNewExecution:true});
  assert.equal(decision.blocked,true);
  assert.equal(decision.code,'PAYMENT_LIMIT_RECIPIENTS_EXCEEDED');
});

test('P0 code contract enforces MFA step-up, 180-day retention and verified daily backup',async()=>{
  const gateway=await readFile(new URL('../functions/api/payment-gateway.js',import.meta.url),'utf8');
  const operating=await readFile(new URL('../functions/api/operating-model-d1.js',import.meta.url),'utf8');
  const retention=await readFile(new URL('../functions/api/integration-monitor.js',import.meta.url),'utf8');
  const backup=await readFile(new URL('../.github/workflows/security-backup.yml',import.meta.url),'utf8');
  const backupVerifier=await readFile(new URL('../scripts/verify-d1-backup.mjs',import.meta.url),'utf8');
  const login=await readFile(new URL('../functions/api/login.js',import.meta.url),'utf8');
  const authUi=await readFile(new URL('../src/components/AuthViews.tsx',import.meta.url),'utf8');

  assert.match(gateway,/MFA_STEP_UP_REQUIRED/);
  assert.match(gateway,/beneficiaryFraudDecision/);
  assert.match(gateway,/paymentLimitDecision/);
  assert.match(operating,/MFA_STEP_UP_REQUIRED/);
  assert.match(operating,/actorFraudDecision/);
  assert.match(retention,/Math\.max\(180/);
  assert.match(backup,/cron:/);
  assert.match(backup,/wrangler d1 export proqpay-lite-production --remote/);
  assert.match(backup,/verify-d1-backup\.mjs/);
  assert.match(backupVerifier,/PRAGMA integrity_check/);
  assert.match(login,/MFA_ENROLLMENT_REQUIRED/);
  assert.match(authUi,/ENROLL_ACTIVATE/);
  assert.match(authUi,/one-time-code/);
});
