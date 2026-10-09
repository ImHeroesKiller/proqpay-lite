import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow=await readFile(new URL('../.github/workflows/cloudflare-deploy.yml',import.meta.url),'utf8');
const migrationWorkflow=await readFile(new URL('../.github/workflows/cloudflare-d1-migrations.yml',import.meta.url),'utf8');

test('production deploy is application-only and never mutates D1 or privileged auth state',()=>{
  assert.match(workflow,/workflow_run:/);
  assert.match(workflow,/workflows: \["Cloudflare D1 Reviewed Migrations"\]/);
  assert.match(workflow,/pages deploy out/);
  assert.match(workflow,/project\?\.\['Project Name'\]/);
  assert.match(workflow,/Verify reviewed release convergence/);
  assert.doesNotMatch(workflow,/wrangler d1 (?:list|execute|export|migrations|create)/);
  assert.doesNotMatch(workflow,/DELETE FROM app_user_mfa/);
  assert.doesNotMatch(workflow,/app_user_passkeys/);
  assert.doesNotMatch(workflow,/UAT_SECURITY_BOOTSTRAP_RESET/);
  assert.doesNotMatch(workflow,/seed-employee-portal-passwords/);
  assert.doesNotMatch(workflow,/e2pay-uat-fresh-seed\.sql/);
});

test('production deploy still verifies reviewed SHA, health, browser security and MFA enforcement',()=>{
  assert.match(workflow,/RELEASE_SHA/);
  assert.match(workflow,/release\.json/);
  assert.match(workflow,/\/api\/health/);
  assert.match(workflow,/content-security-policy/);
  assert.match(workflow,/verify-production-mfa\.mjs/);
  assert.match(workflow,/production-smoke\.mjs/);
});


test('reviewed D1 migrations run after Quality Gate and before the app-only deploy',()=>{
  assert.match(migrationWorkflow,/workflows: \["Quality Gate"\]/);
  assert.match(migrationWorkflow,/wrangler d1 export/);
  assert.match(migrationWorkflow,/verify-d1-backup\.mjs/);
  assert.match(migrationWorkflow,/wrangler d1 migrations apply/);
  assert.match(migrationWorkflow,/e2pay_disbursement_limit_requests/);
  assert.match(migrationWorkflow,/payment_instruction_provider_routing_immutable/);
  assert.doesNotMatch(migrationWorkflow,/e2pay-uat-fresh-seed\.sql/);
  assert.doesNotMatch(migrationWorkflow,/DELETE FROM app_user_mfa/);
});
