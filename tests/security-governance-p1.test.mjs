import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { recordFraudIncident } from '../functions/api/_fraud-incidents.js';
import { D1Mock } from './helpers/d1-mock.mjs';

test('P1 schema contains fraud incident lifecycle and repaired Billing SLA parent table',()=>{
  const DB=new D1Mock();
  const tables=new Set(DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row)=>row.name));
  assert.ok(tables.has('fraud_incidents'));
  assert.ok(tables.has('billing_sla_policies'));
  const columns=new Set(DB.sqlite.prepare("PRAGMA table_info(fraud_incidents)").all().map((row)=>row.name));
  for(const name of ['severity','status','due_at','occurrence_count','assigned_to','escalated_at','resolved_at']){
    assert.ok(columns.has(name),`missing fraud_incidents.${name}`);
  }
});

test('P1 fraud incident recorder deduplicates active repeated signals and increments occurrence count',async()=>{
  const DB=new D1Mock();
  const input={
    orgId:'ORG-OTSINDO',
    source:'PAYMENT_GATEWAY',
    ruleCode:'PAYMENT_LIMIT_SINGLE_EXCEEDED',
    severity:'HIGH',
    entity:'payment_instruction',
    entityId:'PI-P1-001',
    actorUserId:'USR-P1',
    summary:'Payment exceeded configured security limit',
    metadata:{amount:1500000},
  };
  const first=await recordFraudIncident(DB,input);
  const second=await recordFraudIncident(DB,{...input,metadata:{amount:1600000}});
  assert.equal(first.created,true);
  assert.equal(second.created,false);
  assert.equal(first.id,second.id);
  const row=DB.sqlite.prepare('SELECT occurrence_count,status,severity,metadata_json FROM fraud_incidents WHERE id=?').get(first.id);
  assert.equal(row.occurrence_count,2);
  assert.equal(row.status,'OPEN');
  assert.equal(row.severity,'HIGH');
  assert.equal(JSON.parse(row.metadata_json).amount,1600000);
});

test('P1 operational contracts are automated and documented',async()=>{
  const migration=await readFile(new URL('../migrations/0048_security_governance_operational_readiness.sql',import.meta.url),'utf8');
  const sca=await readFile(new URL('../.github/workflows/security-sca.yml',import.meta.url),'utf8');
  const uptime=await readFile(new URL('../.github/workflows/security-uptime.yml',import.meta.url),'utf8');
  const dependabot=await readFile(new URL('../.github/dependabot.yml',import.meta.url),'utf8');
  const policy=await readFile(new URL('../docs/SECURITY_POLICY.md',import.meta.url),'utf8');
  const incident=await readFile(new URL('../docs/INCIDENT_RESPONSE_RUNBOOK.md',import.meta.url),'utf8');
  const vuln=await readFile(new URL('../docs/VULNERABILITY_PATCH_MANAGEMENT.md',import.meta.url),'utf8');
  const login=await readFile(new URL('../functions/api/login.js',import.meta.url),'utf8');
  const payment=await readFile(new URL('../functions/api/payment-gateway.js',import.meta.url),'utf8');

  assert.match(migration,/CREATE TABLE IF NOT EXISTS billing_sla_policies/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS fraud_incidents/);
  assert.match(sca,/npm audit --audit-level=high/);
  assert.match(uptime,/cron: "\*\/15 \* \* \* \*"/);
  assert.match(uptime,/INCIDENT_RESPONSE_RUNBOOK\.md/);
  assert.match(dependabot,/interval: daily/);
  assert.match(policy,/MFA/);
  assert.match(policy,/180 days/);
  assert.match(incident,/S1 \/ Critical/);
  assert.match(incident,/dual review/);
  assert.match(vuln,/Critical: <= 7 calendar days/);
  assert.match(vuln,/High: <= 14 calendar days/);
  assert.match(login,/recordFraudIncident/);
  assert.match(payment,/recordFraudIncident/);
});

test('P1 security incident modules parse as valid JavaScript',()=>{
  for(const relative of ['../functions/api/_fraud-incidents.js','../functions/api/security-incidents.js']){
    const url=new URL(relative,import.meta.url);
    const checked=spawnSync(process.execPath,['--check',fileURLToPath(url)],{encoding:'utf8'});
    assert.equal(checked.status,0,checked.stderr||checked.stdout);
  }
});
