import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';

const closureSql=await readFile(new URL('../ops/p57-production-closure.sql',import.meta.url),'utf8');
const assurance=await readFile(new URL('../.github/workflows/production-operational-assurance.yml',import.meta.url),'utf8');
const playwright=await readFile(new URL('../tests/e2e/p57-production-closure.spec.mjs',import.meta.url),'utf8');

test('P5.7.10 closure SQL covers canonical approval, routing, funding, settlement and legacy collision invariants',()=>{
  for(const marker of [
    'DR_APPROVAL_METADATA_MISSING','DR_EXECUTION_LEDGER_MISSING','DR_CONTROL_TOTAL_MISMATCH','DR_PROVIDER_CHANNEL_MISSING',
    'ACTIVE_CHANNEL_UNCONFIRMED','CORPORATE_PRIMARY_UNGOVERNED','CANONICAL_LIMIT_DUPLICATE','SETTLED_DR_HAS_UNSETTLED_ITEM',
    'RECONCILED_DR_WITHOUT_ATTEMPT','LEGACY_INFLIGHT_CANONICAL_COLLISION',
  ]) assert.match(closureSql,new RegExp(marker));
});

test('P5.7.10 closure SQL executes cleanly against complete migrated D1 schema',()=>{
  const db=new D1Mock();
  for(const statement of closureSql.split(';').map(v=>v.trim()).filter(Boolean)){
    if(statement.startsWith('--')){
      const sql=statement.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n').trim();
      if(sql) assert.doesNotThrow(()=>db.sqlite.prepare(sql).all());
    }else assert.doesNotThrow(()=>db.sqlite.prepare(statement).all());
  }
});

test('P5.7.10 production assurance includes all P5.7 bundles and live canonical D1 assertions',()=>{
  for(let phase=1;phase<=10;phase++) assert.match(assurance,new RegExp(`p57-${phase}|p5\\.7\\.${phase}`, 'i'));
  assert.match(assurance,/p57-production-closure\.sql/);
  assert.match(assurance,/Verify P5\.7 canonical production invariants/);
});

test('P5.7.10 browser closure never attempts MFA enrollment/reset and checks new protected APIs fail closed',()=>{
  assert.doesNotMatch(playwright,/ENROLL_START|ENROLL_ACTIVATE|REGISTER_VERIFY/);
  for(const path of ['disbursement-requests','disbursement-executions','canonical-transaction-register','legacy-compatibility','client-bank-beneficiaries']) assert.match(playwright,new RegExp(path));
});
