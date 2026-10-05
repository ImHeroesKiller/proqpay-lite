import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { authenticateSession, createSession } from '../functions/api/_account-auth.js';
import { enforceRateLimit } from '../functions/api/_security.js';
import { requestSecurityContext } from '../functions/api/_security-context.js';
import { D1Mock } from './helpers/d1-mock.mjs';

const envBase={
  DEFAULT_ORG_ID:'ORG-OTSINDO',
  SECURITY_CONTEXT_KEY:'p2-security-context-key-that-is-definitely-longer-than-thirty-two',
  SECURITY_SESSION_DEVICE_MODE:'ENFORCE_CRITICAL',
  SECURITY_D1_RATE_LIMIT_FALLBACK:'ENFORCE',
};

function insertUser(DB,{id,role,email}){
  DB.sqlite.exec(`
    INSERT OR IGNORE INTO organizations(id,name,code) VALUES('ORG-OTSINDO','OTSINDO','OTS');
  `);
  DB.sqlite.prepare(`INSERT INTO app_users
    (id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
    VALUES(?,?,?,?,?,'ACTIVE','h','s',100000,0,0,'test')`)
    .run(id,'ORG-OTSINDO',id,email,role);
}

test('P2 schema includes session anomaly, D1 limiter and audit checkpoint controls',()=>{
  const DB=new D1Mock();
  const sessionColumns=new Set(DB.sqlite.prepare('PRAGMA table_info(app_sessions)').all().map((row)=>row.name));
  for(const name of ['current_ip_hash','current_device_hash','anomaly_count','last_anomaly_at']){
    assert.ok(sessionColumns.has(name),`missing app_sessions.${name}`);
  }
  const tables=new Set(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row)=>row.name));
  assert.ok(tables.has('security_rate_limits'));
  assert.ok(tables.has('security_audit_checkpoints'));
});

test('P2 D1 rate-limit fallback blocks excessive login attempts without native binding',async()=>{
  const DB=new D1Mock();
  const env={...envBase,DB};
  const request=new Request('https://proqpay.test/api/login',{
    headers:{'CF-Connecting-IP':'203.0.113.10'},
  });
  for(let index=0;index<10;index+=1){
    assert.equal(await enforceRateLimit(request,env,{id:'anonymous-login'},'account-login','POST, OPTIONS'),null);
  }
  const blocked=await enforceRateLimit(request,env,{id:'anonymous-login'},'account-login','POST, OPTIONS');
  assert.equal(blocked.status,429);
  assert.equal(blocked.headers.get('Retry-After'),'60');
});

test('P2 critical-role device fingerprint drift revokes session and creates incident',async()=>{
  const DB=new D1Mock();
  const env={...envBase,DB};
  insertUser(DB,{id:'USR-P2-ADMIN',role:'SUPER_ADMIN',email:'p2.admin@example.test'});

  const requestA=new Request('https://proqpay.test/api/me',{
    headers:{
      'CF-Connecting-IP':'203.0.113.20',
      'User-Agent':'P2-Browser-A',
      'Accept-Language':'id-ID',
    },
  });
  const contextA=await requestSecurityContext(requestA,env);
  const session=await createSession(DB,'USR-P2-ADMIN',env,{context:contextA});

  const requestB=new Request('https://proqpay.test/api/me',{
    headers:{
      Cookie:`proqpay_session=${encodeURIComponent(session.token)}`,
      'CF-Connecting-IP':'203.0.113.20',
      'User-Agent':'P2-Browser-B',
      'Accept-Language':'id-ID',
    },
  });
  assert.equal(await authenticateSession(requestB,env),null);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS total FROM app_sessions WHERE user_id=?').get('USR-P2-ADMIN').total,0);
  const incident=DB.sqlite.prepare("SELECT rule_code,severity,status FROM fraud_incidents WHERE actor_user_id=? ORDER BY created_at DESC LIMIT 1").get('USR-P2-ADMIN');
  assert.equal(incident.rule_code,'SESSION_DEVICE_FINGERPRINT_CHANGED');
  assert.equal(incident.severity,'HIGH');
  assert.equal(incident.status,'OPEN');
});

test('P2 browser policy and production verification enforce CSP hardening',async()=>{
  const headers=await readFile(new URL('../public/_headers',import.meta.url),'utf8');
  const uptime=await readFile(new URL('../.github/workflows/security-uptime.yml',import.meta.url),'utf8');
  const prepare=await readFile(new URL('../scripts/prepare-pages-config.mjs',import.meta.url),'utf8');
  assert.match(headers,/Content-Security-Policy:/);
  assert.match(headers,/frame-ancestors 'none'/);
  assert.match(headers,/object-src 'none'/);
  assert.match(headers,/Cross-Origin-Opener-Policy: same-origin/);
  assert.doesNotMatch(headers,/^\s*Access-Control-Allow-Origin:/m);
  const cspHardener=await readFile(new URL('../scripts/harden-static-csp.mjs',import.meta.url),'utf8');
  assert.match(cspHardener,/script-src-elem/);
  assert.match(cspHardener,/script-src\(\?:-elem\)\?/);
  assert.match(uptime,/Verify production browser security headers/);
  assert.match(uptime,/content-security-policy/);
  assert.match(prepare,/SECURITY_SESSION_DEVICE_MODE:\s*'ENFORCE_CRITICAL'/);
  assert.match(prepare,/SECURITY_D1_RATE_LIMIT_FALLBACK:\s*'ENFORCE'/);
});

test('P2 audit checkpoint script creates non-sensitive SHA-256 evidence and seal SQL',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'proqpay-p2-'));
  const rowsPath=path.join(dir,'rows.json');
  const checkpointsPath=path.join(dir,'checkpoints.json');
  const evidencePath=path.join(dir,'evidence.json');
  const sqlPath=path.join(dir,'checkpoint.sql');
  const yesterday=new Date(Date.now()-86_400_000).toISOString().slice(0,10);
  await writeFile(rowsPath,JSON.stringify([{results:[{
    id:'AUD-P2-1',timestamp:`${yesterday}T03:00:00.000Z`,username:'admin@example.test',role:'SUPER_ADMIN',
    action:'P2_TEST',detail:'safe test',entity:'security',entity_id:'P2',correlation_id:null,
    ip_hash:'hash-ip',device_hash:'hash-device',security_context_json:null,
  }]}]));
  await writeFile(checkpointsPath,JSON.stringify([{results:[]}]));
  const scriptUrl=new URL('../scripts/security-audit-checkpoint.mjs',import.meta.url);
  const run=spawnSync(process.execPath,[fileURLToPath(scriptUrl),rowsPath,checkpointsPath,evidencePath,sqlPath],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const evidence=JSON.parse(await readFile(evidencePath,'utf8'));
  const sqlText=await readFile(sqlPath,'utf8');
  assert.equal(evidence.target.checkpointDate,yesterday);
  assert.equal(evidence.target.rowCount,1);
  assert.match(evidence.target.contentSha256,/^[a-f0-9]{64}$/);
  assert.match(sqlText,/INSERT INTO security_audit_checkpoints/);
  assert.doesNotMatch(JSON.stringify(evidence),/safe test/);
});

test('P2 security modules and checkpoint script parse as valid JavaScript',()=>{
  for(const relative of [
    '../functions/api/_account-auth.js',
    '../functions/api/_security.js',
    '../scripts/security-audit-checkpoint.mjs',
  ]){
    const url=new URL(relative,import.meta.url);
    const checked=spawnSync(process.execPath,['--check',fileURLToPath(url)],{encoding:'utf8'});
    assert.equal(checked.status,0,checked.stderr||checked.stdout);
  }
});
