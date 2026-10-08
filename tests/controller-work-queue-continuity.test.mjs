import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { derivePayrollNextAction } from '../src/lib/payroll-next-action-core.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Controller owns CONTROLLER_REVIEW regardless of navigation period',async()=>{
  const action=derivePayrollNextAction({
    role:'PAYROLL_CONTROLLER',
    permissions:['approval:write','payment:approve'],
    state:'CONTROLLER_REVIEW',
  });
  assert.equal(action.actionable,true);
  assert.equal(action.category,'APPROVAL');
  assert.equal(action.owner,'PAYROLL_CONTROLLER');
  assert.equal(action.workflowCommand,'CLIENT_APPROVAL_PENDING');

  const queue=await import('../src/lib/payroll-work-queue-core.js');
  assert.equal(queue.includeSubmissionForWorkspace({
    role:'PAYROLL_CONTROLLER',
    row:{id:'SUB-ATE-SEP',period:'2026-09',payment_period:'2026-09'},
    period:'2026-10',
    nextAction:action,
  }),true);
  assert.equal(queue.includeSubmissionForWorkspace({
    role:'PAYROLL_PROCESSOR',
    row:{id:'SUB-ATE-SEP',period:'2026-09',payment_period:'2026-09'},
    period:'2026-10',
    nextAction:action,
  }),false);
});

test('Focused submission bypasses stale period and filter browse scope',async()=>{
  const queue=await import('../src/lib/payroll-work-queue-core.js');
  assert.equal(queue.includeSubmissionForWorkspace({
    role:'PAYROLL_CONTROLLER',
    row:{id:'SUB-ATE-SEP',period:'2026-09'},
    period:'2026-10',
    focusSubmissionId:'SUB-ATE-SEP',
    nextAction:{actionable:false},
  }),true);
  assert.equal(queue.includeSubmissionForWorkspace({
    role:'PAYROLL_CONTROLLER',
    row:{id:'SUB-OTHER',period:'2026-10'},
    period:'2026-10',
    focusSubmissionId:'SUB-ATE-SEP',
    nextAction:{actionable:true},
  }),false);
});

test('Controller payment queue remains visible across periods for owned statuses',async()=>{
  const queue=await import('../src/lib/payroll-work-queue-core.js');
  assert.equal(queue.includePaymentForWorkspace({
    role:'PAYROLL_CONTROLLER',
    row:{submission_id:'SUB-1',payroll_period:'2026-09',payment_period:'2026-09',status:'PAYMENT_APPROVAL_PENDING'},
    period:'2026-10',
  }),true);
  assert.equal(queue.includePaymentForWorkspace({
    role:'PAYROLL_PROCESSOR',
    row:{submission_id:'SUB-1',payroll_period:'2026-09',payment_period:'2026-09',status:'PAYMENT_APPROVAL_PENDING'},
    period:'2026-10',
  }),false);
});

test('Submission transport is fully paginated instead of silently stopping at 200',async()=>{
  const [backend,api,workspace]=await Promise.all([
    read('functions/api/operating-model-d1.js'),
    read('src/lib/operating-model-api.ts'),
    read('src/components/OperatingWorkspace.tsx'),
  ]);
  assert.match(backend,/resource === 'submissions'/);
  assert.match(backend,/submissionsMeta:{ offset:submissionOffset, limit:submissionLimit/);
  assert.match(backend,/submissionLimit \+ 1, submissionOffset/);
  assert.match(api,/function listAllOperatingSubmissions/);
  assert.match(api,/page\.submissionsMeta\?\.nextOffset/);
  assert.match(workspace,/resource === 'submissions' \? listAllOperatingSubmissions/);
});

test('Controller dashboard requests cross-period work while portfolio remains period-filtered',async()=>{
  const source=await read('src/components/PayrollControlTower.tsx');
  assert.match(source,/actor\.role==='PAYROLL_CONTROLLER'\?'ALL':period/);
  assert.match(source,/matchesDashboardFilters\(row,actor\.role!=='PAYROLL_CONTROLLER'\)/);
  assert.match(source,/const visible=useMemo\(\(\)=>operationalSubmissions\.filter\(\(row\)=>matchesDashboardFilters\(row,true\)\)/);
  assert.match(source,/const awaitingApproval=actionScope\.filter/);
  assert.match(source,/return actionScope[\s\S]*?\.map/);
});

test('Operating cache is isolated by authenticated actor identity',async()=>{
  const [api,page]=await Promise.all([
    read('src/lib/operating-model-api.ts'),
    read('src/app/page.tsx'),
  ]);
  assert.match(api,/let cacheActorNamespace = 'anonymous'/);
  assert.match(api,/function cacheKey\(url:string\)/);
  assert.match(api,/export function setOperatingCacheActor/);
  assert.match(api,/responseCache\.clear\(\);[\s\S]*?inflightRequests\.clear\(\)/);
  assert.match(page,/setOperatingCacheActor\(authenticatedActor\)/);
  assert.match(page,/setOperatingCacheActor\(null\)/);
});
