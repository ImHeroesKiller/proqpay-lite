import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createSession } from '../functions/api/_account-auth.js';
import { authorize } from '../functions/api/_security.js';
import { beginPasskeyRegistration } from '../functions/api/_webauthn.js';
import { requestSecurityContext } from '../functions/api/_security-context.js';
import { onRequest as canonicalMiddleware } from '../functions/_middleware.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const envBase={
  DEFAULT_ORG_ID:'ORG-OTSINDO',
  AUTH_MODE:'session',
  SECURITY_CONTEXT_KEY:'p2-1-security-context-key-that-is-definitely-long-enough',
  SECURITY_PASSKEY_ENFORCEMENT:'ENFORCE',
  WEBAUTHN_RP_ID:'proqpay.msg-os.com',
  WEBAUTHN_RP_NAME:'ProQPay',
  WEBAUTHN_ORIGINS:'https://proqpay.msg-os.com',
};

function insertUser(DB,{id='USR-P21',role='SUPER_ADMIN',email='p21@example.test'}={}){
  DB.sqlite.exec("INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-OTSINDO','OTSINDO','OTS')");
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by,mfa_required)
    VALUES(?,?,?,?,?,'ACTIVE','h','s',100000,0,0,'test',1)`)
    .run(id,'ORG-OTSINDO','P2.1 User',email,role);
  return {id,name:'P2.1 User',email,role,org_id:'ORG-OTSINDO'};
}

test('P2.1 schema contains passkeys, challenges, and phishing-resistant session strength',()=>{
  const DB=new D1Mock();
  const tables=new Set(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row)=>row.name));
  assert.ok(tables.has('app_user_passkeys'));
  assert.ok(tables.has('webauthn_challenges'));
  const sessionColumns=new Set(DB.sqlite.prepare('PRAGMA table_info(app_sessions)').all().map((row)=>row.name));
  assert.ok(sessionColumns.has('auth_strength'));
  assert.ok(sessionColumns.has('passkey_verified_at'));
});

test('P2.1 registration options require discoverable credential and user verification on canonical RP',async()=>{
  const DB=new D1Mock();
  const user=insertUser(DB);
  const request=new Request('https://proqpay.msg-os.com/api/security-passkey',{
    headers:{Origin:'https://proqpay.msg-os.com'},
  });
  const started=await beginPasskeyRegistration(DB,request,{...envBase,DB},user);
  assert.ok(started.challengeId.startsWith('WAC-'));
  assert.equal(started.options.rp.id,'proqpay.msg-os.com');
  assert.equal(started.options.authenticatorSelection?.residentKey,'required');
  assert.equal(started.options.authenticatorSelection?.userVerification,'required');
  const row=DB.sqlite.prepare('SELECT purpose,rp_id,expected_origin,consumed_at FROM webauthn_challenges WHERE id=?').get(started.challengeId);
  assert.equal(row.purpose,'REGISTER');
  assert.equal(row.rp_id,'proqpay.msg-os.com');
  assert.equal(row.expected_origin,'https://proqpay.msg-os.com');
  assert.equal(row.consumed_at,null);
});

test('P2.1 privileged authorization is fail-closed before passkey enrollment',async()=>{
  const DB=new D1Mock();
  const user=insertUser(DB);
  const baseRequest=new Request('https://proqpay.msg-os.com/api/clients',{
    headers:{
      Origin:'https://proqpay.msg-os.com',
      'CF-Connecting-IP':'203.0.113.51',
      'User-Agent':'P21 Browser',
      'Accept-Language':'id-ID',
    },
  });
  const context=await requestSecurityContext(baseRequest,{...envBase,DB});
  const session=await createSession(DB,user.id,{...envBase,DB},{
    context,
    mfaVerifiedAt:new Date().toISOString(),
    authStrength:'PASSWORD_TOTP',
  });
  const request=new Request(baseRequest.url,{
    headers:{
      Origin:'https://proqpay.msg-os.com',
      'CF-Connecting-IP':'203.0.113.51',
      'User-Agent':'P21 Browser',
      'Accept-Language':'id-ID',
      Cookie:`proqpay_session=${encodeURIComponent(session.token)}`,
    },
  });
  const denied=await authorize(request,{...envBase,DB},{roles:['SUPER_ADMIN']});
  assert.equal(denied.response?.status,428);
  assert.equal((await denied.response.json()).code,'PASSKEY_ENROLLMENT_REQUIRED');
});

test('P2.1 privileged authorization rejects TOTP-only session after a passkey exists',async()=>{
  const DB=new D1Mock();
  const user=insertUser(DB,{id:'USR-P21-2',email:'p212@example.test'});
  DB.sqlite.prepare(`INSERT INTO app_user_passkeys
    (id,user_id,credential_id,public_key_b64,counter,transports_json,status)
    VALUES('PASSKEY-P21','USR-P21-2','cred-p21','AA',0,'[]','ACTIVE')`).run();
  const baseRequest=new Request('https://proqpay.msg-os.com/api/clients',{
    headers:{
      Origin:'https://proqpay.msg-os.com',
      'CF-Connecting-IP':'203.0.113.52',
      'User-Agent':'P21 Browser',
      'Accept-Language':'id-ID',
    },
  });
  const context=await requestSecurityContext(baseRequest,{...envBase,DB});
  const session=await createSession(DB,user.id,{...envBase,DB},{
    context,
    mfaVerifiedAt:new Date().toISOString(),
    authStrength:'PASSWORD_TOTP',
  });
  const request=new Request(baseRequest.url,{
    headers:{
      Origin:'https://proqpay.msg-os.com',
      'CF-Connecting-IP':'203.0.113.52',
      'User-Agent':'P21 Browser',
      'Accept-Language':'id-ID',
      Cookie:`proqpay_session=${encodeURIComponent(session.token)}`,
    },
  });
  const denied=await authorize(request,{...envBase,DB},{roles:['SUPER_ADMIN']});
  assert.equal(denied.response?.status,428);
  assert.equal((await denied.response.json()).code,'PASSKEY_REAUTH_REQUIRED');
});

test('P2.1 canonical middleware replaces Cloudflare static wildcard CORS with canonical origin',async()=>{
  const env={CANONICAL_ORIGIN:'https://proqpay.msg-os.com'};
  const response=await canonicalMiddleware({
    request:new Request('https://proqpay.msg-os.com/robots.txt'),
    env,
    next:async()=>new Response('ok',{status:200,headers:{'Access-Control-Allow-Origin':'*'}}),
  });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://proqpay.msg-os.com');
  assert.equal(response.headers.get('Vary'),'Origin');

  const api=await canonicalMiddleware({
    request:new Request('https://proqpay.msg-os.com/api/health'),
    env,
    next:async()=>new Response('ok',{status:200,headers:{'Access-Control-Allow-Origin':'*'}}),
  });
  assert.equal(api.headers.get('Access-Control-Allow-Origin'),'*');
});

test('P2.1 canonical middleware redirects reads, rejects mutations, and preserves health probe',async()=>{
  const env={CANONICAL_ORIGIN:'https://proqpay.msg-os.com'};
  const redirected=await canonicalMiddleware({
    request:new Request('https://proqpay-lite.pages.dev/dashboard?x=1'),
    env,
    next:async()=>new Response('next'),
  });
  assert.equal(redirected.status,308);
  assert.equal(redirected.headers.get('location'),'https://proqpay.msg-os.com/dashboard?x=1');

  const rejected=await canonicalMiddleware({
    request:new Request('https://proqpay-lite.pages.dev/api/login',{method:'POST'}),
    env,
    next:async()=>new Response('next'),
  });
  assert.equal(rejected.status,421);

  const health=await canonicalMiddleware({
    request:new Request('https://proqpay-lite.pages.dev/api/health'),
    env,
    next:async()=>new Response('ok',{status:200}),
  });
  assert.equal(health.status,200);
});

test('P2.1 production contracts enforce passkey RP, custom domain and WAF evidence',async()=>{
  const login=await readFile(new URL('../functions/api/login.js',import.meta.url),'utf8');
  const security=await readFile(new URL('../functions/api/_security.js',import.meta.url),'utf8');
  const config=await readFile(new URL('../scripts/prepare-pages-config.mjs',import.meta.url),'utf8');
  const edge=await readFile(new URL('../scripts/cloudflare-edge-closure.mjs',import.meta.url),'utf8');
  const deploy=await readFile(new URL('../.github/workflows/cloudflare-deploy.yml',import.meta.url),'utf8');
  const recovery=await readFile(new URL('../functions/api/security-passkey-recovery.js',import.meta.url),'utf8');

  assert.match(login,/PASSKEY_REQUIRED/);
  assert.match(login,/finishPasskeyAuthentication/);
  assert.match(security,/PASSKEY_ENROLLMENT_REQUIRED/);
  assert.match(security,/PASSKEY_REAUTH_REQUIRED/);
  assert.match(config,/SECURITY_PASSKEY_ENFORCEMENT:\s*'ENFORCE'/);
  assert.match(config,/WEBAUTHN_RP_ID:\s*customDomain/);
  assert.match(edge,/pages\/projects\/\$\{project\}\/domains/);
  assert.match(edge,/http_request_firewall_managed/);
  assert.match(edge,/free managed ruleset/);
  assert.match(edge,/cloudflare-free-plan-default/);
  assert.match(edge,/defaultOnFreePlan:true/);
  assert.match(deploy,/proqpay-edge-closure/);
  assert.match(deploy,/PROQPAY_CUSTOM_DOMAIN/);
  assert.match(recovery,/PASSKEY_RECOVERY_USED/);
});

test('P2.1 security modules parse as valid JavaScript',()=>{
  for(const relative of [
    '../functions/api/_webauthn.js',
    '../functions/api/security-passkey.js',
    '../functions/api/security-passkey-recovery.js',
    '../functions/_middleware.js',
    '../scripts/cloudflare-edge-closure.mjs',
  ]){
    const url=new URL(relative,import.meta.url);
    const checked=spawnSync(process.execPath,['--check',fileURLToPath(url)],{encoding:'utf8'});
    assert.equal(checked.status,0,checked.stderr||checked.stdout);
  }
});
