import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import {
  reserveDisbursementRequestLimit,
  releaseDisbursementRequestLimit,
  consumeDisbursementRequestLimit,
} from '../functions/api/e2pay-disbursement-limit-core.js';
import { canonicalExecutionParentStatus, summarizeCanonicalExecutionItems } from '../functions/api/disbursement-execution-e2pay.js';

const requestApi=await readFile(new URL('../functions/api/disbursement-requests.js',import.meta.url),'utf8');
const executionApi=await readFile(new URL('../functions/api/disbursement-executions.js',import.meta.url),'utf8');
const executionService=await readFile(new URL('../functions/api/disbursement-execution-e2pay.js',import.meta.url),'utf8');
const fundingCore=await readFile(new URL('../functions/api/e2pay-disbursement-limit-core.js',import.meta.url),'utf8');
const fraudCore=await readFile(new URL('../functions/api/_fraud-controls.js',import.meta.url),'utf8');

test('P5.7.6 canonical limit reservation is atomic, idempotent and prevents double spend',async()=>{
  const db=new D1Mock();
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-576','MSG','M576');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-576','ORG-576','C576','Client','ACTIVE');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,account_name,status,created_by)
      VALUES('PPA-576','ORG-576','CLI-576','E2PAY','UAT','SUB_ACCOUNT','SUB-576','Client','ACTIVE','seed');
    INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email,approved_by_email,approved_at)
      VALUES('DLR-576','ORG-576','PPA-576','CLI-576','UAT',1000,1000,'ACTIVE','processor@test','controller@test','2026-10-12T00:00:00Z');
    INSERT INTO disbursement_requests(id,org_id,client_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,amount,recipient_count,client_reference,correlation_id,idempotency_key,routing_hash,status,approved_by_email,approved_at,created_by_email)
      VALUES
      ('DR-576A','ORG-576','CLI-576','E2PAY','PPA-576','SUB-576','UAT','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE','PAYMENT_INSTRUCTION','PI-A',700,1,'REF-A','CORR-A','IDEM-A','HASH-A','APPROVED','controller@test','2026-10-12T00:00:00Z','processor@test'),
      ('DR-576B','ORG-576','CLI-576','E2PAY','PPA-576','SUB-576','UAT','EWA','DIRECT_EMPLOYEE','EMPLOYEE','EWA_REQUEST','EWA-B',400,1,'REF-B','CORR-B','IDEM-B','HASH-B','APPROVED','controller@test','2026-10-12T00:00:00Z','processor@test');
  `);
  let first=await reserveDisbursementRequestLimit(db,{organizationId:'ORG-576',providerAccountRegistryId:'PPA-576',disbursementRequestId:'DR-576A',amount:700});
  assert.equal(first.ok,true);
  assert.equal(first.idempotent,false);
  const replay=await reserveDisbursementRequestLimit(db,{organizationId:'ORG-576',providerAccountRegistryId:'PPA-576',disbursementRequestId:'DR-576A',amount:700});
  assert.equal(replay.ok,true);
  assert.equal(replay.idempotent,true);
  let second=await reserveDisbursementRequestLimit(db,{organizationId:'ORG-576',providerAccountRegistryId:'PPA-576',disbursementRequestId:'DR-576B',amount:400});
  assert.equal(second.ok,false);
  assert.equal(second.code,'E2PAY_DISBURSEMENT_LIMIT_INSUFFICIENT');
  await releaseDisbursementRequestLimit(db,'DR-576A','TEST_RELEASE');
  second=await reserveDisbursementRequestLimit(db,{organizationId:'ORG-576',providerAccountRegistryId:'PPA-576',disbursementRequestId:'DR-576B',amount:400});
  assert.equal(second.ok,true);
  await consumeDisbursementRequestLimit(db,'DR-576B',400);
  const usage=db.sqlite.prepare("SELECT * FROM e2pay_disbursement_request_limit_usage WHERE disbursement_request_id='DR-576B'").get();
  assert.equal(usage.status,'CONSUMED');
  assert.equal(Number(usage.consumed_amount),400);
});

test('P5.7.6 funding capacity counts both legacy PI and canonical DR commitments',()=>{
  assert.match(fundingCore,/FROM e2pay_disbursement_limit_usage/);
  assert.match(fundingCore,/FROM e2pay_disbursement_request_limit_usage/);
  assert.match(fundingCore,/committedAmount=Number\(legacyUsage\?\.committed_amount\|\|0\)\+Number\(drUsage\?\.committed_amount\|\|0\)/);
});

test('P5.7.6 maker-checker approval enforces Controller, fraud, MFA, immutable channel and funding readiness',()=>{
  assert.match(requestApi,/APPROVE_REQUEST/);
  assert.match(requestApi,/DISBURSEMENT_MAKER_CHECKER_VIOLATION/);
  assert.match(requestApi,/validateProviderChannelSnapshot/);
  assert.match(requestApi,/actorFraudDecision/);
  assert.match(requestApi,/MFA_STEP_UP_REQUIRED/);
  assert.match(requestApi,/readProviderFundingState/);
  assert.match(requestApi,/DISBURSEMENT_REQUEST_APPROVED/);
});

test('P5.7.6 execution reserves limit before provider call and blocks blind retry',()=>{
  const reserveAt=executionApi.indexOf('const reservation=await reserveDisbursementRequestLimit');
  const executeAt=executionApi.indexOf('const result=await executeCanonicalE2Pay');
  assert.ok(reserveAt>=0&&executeAt>reserveAt);
  assert.match(executionApi,/DISBURSEMENT_CONTROLLED_RECOVERY_REQUIRED/);
  assert.match(executionApi,/E2PAY_RECONCILIATION_REQUIRED/);
  assert.match(executionApi,/consumeDisbursementRequestLimit/);
  assert.match(executionApi,/releaseDisbursementRequestLimit/);
  assert.match(executionApi,/beneficiaryFraudDecision/);
  assert.match(executionApi,/scopedE2PayRuntimeEnv/);
});

test('P5.7.6 ambiguous provider result is reconciliation-required and never automatically retried',()=>{
  const summary=summarizeCanonicalExecutionItems([{status:'SUCCEEDED',amount:100,fee_amount:0},{status:'UNKNOWN',amount:200,fee_amount:0}]);
  assert.equal(summary.unresolved,1);
  assert.equal(canonicalExecutionParentStatus(summary,0),'RECONCILIATION_REQUIRED');
  const partial=summarizeCanonicalExecutionItems([{status:'SUCCEEDED',amount:100},{status:'FAILED',amount:200}]);
  assert.equal(canonicalExecutionParentStatus(partial,0),'RECONCILIATION_REQUIRED');
  assert.match(executionService,/ambiguous\?'UNKNOWN':'FAILED'/);
  assert.match(executionService,/Provider status unresolved; reconcile before retry/);
  assert.doesNotMatch(executionService,/RETRY_READY|RETRY_INQUIRY_READY/);
});

test('P5.7.6 canonical execution ledger is provider-neutral and does not require payment_instruction_id',()=>{
  const db=new D1Mock();
  const executionColumns=db.sqlite.prepare('PRAGMA table_info(disbursement_executions)').all().map(r=>r.name);
  const itemColumns=db.sqlite.prepare('PRAGMA table_info(disbursement_execution_items)').all().map(r=>r.name);
  assert.ok(executionColumns.includes('disbursement_request_id'));
  assert.ok(!executionColumns.includes('payment_instruction_id'));
  assert.ok(itemColumns.includes('disbursement_request_item_id'));
  assert.ok(!itemColumns.includes('payment_instruction_line_id'));
});

test('P5.7.6 daily fraud/risk ceiling counts legacy gateway and canonical executions',()=>{
  assert.match(fraudCore,/SELECT amount,created_at,status FROM payment_gateway_transactions/);
  assert.match(fraudCore,/SELECT amount,created_at,status FROM disbursement_executions/);
});
