import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const endpoint=await readFile(new URL('../functions/api/e2pay-uat-validation.js',import.meta.url),'utf8');
const workflow=await readFile(new URL('../.github/workflows/e2pay-p5-4-uat-readiness.yml',import.meta.url),'utf8');

test('E2Pay UAT readiness resolves project override before client inheritance',()=>{
  assert.match(endpoint,/activeProviderAccount/);
  assert.match(endpoint,/submission\.project_id\|\|null/);
});

test('push readiness is contract-only and live D1 evidence is explicit/manual',()=>{
  assert.match(workflow,/Run E2Pay contract and lifecycle regression/);
  assert.match(workflow,/workflow_dispatch/);
  assert.match(workflow,/inputs\.live_d1/);
  assert.match(workflow,/CLOUDFLARE_D1_API_TOKEN/);
  assert.match(workflow,/github\.event_name == 'workflow_dispatch' && inputs\.live_d1/);
  assert.match(workflow,/liveRuntime:\{requested:false,status:'NOT_REQUESTED'\}/);
});
