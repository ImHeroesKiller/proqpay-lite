import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';

const integrity=await readFile(new URL('../scripts/security-audit-checkpoint.mjs',import.meta.url),'utf8');
const integrityWorkflow=await readFile(new URL('../.github/workflows/security-audit-integrity.yml',import.meta.url),'utf8');
const sca=await readFile(new URL('../.github/workflows/security-sca.yml',import.meta.url),'utf8');
const e2pay=await readFile(new URL('../.github/workflows/e2pay-p5-4-uat-readiness.yml',import.meta.url),'utf8');
const migration=await readFile(new URL('../migrations/0066_security_audit_integrity_exception.sql',import.meta.url),'utf8');

test('P5.7.10 forensic exception is exact-match and durable',()=>{
  const db=new D1Mock();
  const row=db.sqlite.prepare("SELECT * FROM security_audit_integrity_exceptions WHERE checkpoint_date='2026-10-03'").get();
  assert.equal(Number(row.sealed_row_count),1);
  assert.equal(row.sealed_content_sha256,'0cb302509b4799188d032b0e37019f5283c65f49cf88446d5d4a802acc94d91c');
  assert.equal(Number(row.accepted_row_count),0);
  assert.equal(row.accepted_content_sha256,'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
  assert.match(row.authorized_change_ref,/0046_reset_e2pay_uat_dummy_data/);
  assert.match(migration,/Future audit-log deletion is prohibited/);
});

test('P5.7.10 audit verifier only applies exception when sealed and current fingerprints both match',()=>{
  assert.match(integrity,/Number\(row\.sealed_row_count\) === expectedCount/);
  assert.match(integrity,/String\(row\.sealed_content_sha256\) === expectedHash/);
  assert.match(integrity,/Number\(row\.accepted_row_count\) === current\.rowCount/);
  assert.match(integrity,/String\(row\.accepted_content_sha256\) === current\.contentSha256/);
  assert.match(integrity,/authorizedExceptionsApplied/);
});

test('P5.7.10 security workflows close recovered incidents',()=>{
  assert.match(integrityWorkflow,/Close recovered audit-integrity incident/);
  assert.match(sca,/Close recovered vulnerability issue/);
});

test('P5.7.10 E2Pay live readiness falls back to active production Cloudflare token',()=>{
  assert.match(e2pay,/CLOUDFLARE_D1_API_TOKEN \|\| secrets\.CLOUDFLARE_API_TOKEN/);
});
