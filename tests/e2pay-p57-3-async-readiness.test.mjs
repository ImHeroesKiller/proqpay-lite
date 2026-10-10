import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { deriveClientReadiness } from '../functions/api/client-readiness-core.js';

const operating=await readFile(new URL('../functions/api/operating-model-d1.js',import.meta.url),'utf8');
const readinessApi=await readFile(new URL('../functions/api/client-readiness.js',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');

test('P5.7.3 separates operational readiness from payment readiness',()=>{
  const pending=deriveClientReadiness({clientStatus:'ACTIVE',employeeCount:99,payrollCount:4,providerStatus:'DRAFT',provisioningState:'OTP_REQUIRED',credentialReady:false});
  assert.equal(pending.client.ready,true);
  assert.equal(pending.employees.ready,true);
  assert.equal(pending.payroll.ready,true);
  assert.equal(pending.ewa.ready,true);
  assert.equal(pending.payment.ready,false);
  assert.equal(pending.overall.operationalReady,true);
  assert.equal(pending.overall.paymentReady,false);
  assert.equal(pending.payment.blocking,true);

  const ready=deriveClientReadiness({clientStatus:'ACTIVE',employeeCount:99,payrollCount:4,providerStatus:'ACTIVE',providerSubAccountId:'SUB-1',provisioningState:'READY',credentialReady:true});
  assert.equal(ready.payment.ready,true);
  assert.equal(ready.payment.state,'READY');
});

test('P5.7.3 allows exactly one late provider routing bind while PI is READY',()=>{
  const db=new D1Mock();
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-573','MSG','MSG573');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-573','ORG-573','C573','Client 573','ACTIVE');
    INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by) VALUES('SP-573','CLI-573','TIER_1_PAYMENT_PROCESSING','ACTIVE','2026-01-01','seed');
    INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by) VALUES('PS-573','ORG-573','CLI-573','SP-573','TIER_1_PAYMENT_PROCESSING','2026-10','PAYMENT_INSTRUCTION_READY','seed');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,account_name,status,created_by)
      VALUES('PPA-573','ORG-573','CLI-573','E2PAY','UAT','SUB_ACCOUNT','SUB-573','Client 573','ACTIVE','seed');
    INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key)
      VALUES('PI-573','ORG-573','CLI-573','PS-573','PAYMENT_INSTRUCTION_READY',1000000,'USR','IDEM-573');
  `);
  assert.doesNotThrow(()=>db.sqlite.prepare(`UPDATE payment_instructions SET provider_account_registry_id=?,provider=?,provider_environment=?,provider_sub_account_id=?,provider_account_snapshot=? WHERE id=?`).run('PPA-573','E2PAY','UAT','SUB-573','{}','PI-573'));
  assert.throws(()=>db.sqlite.prepare(`UPDATE payment_instructions SET provider_sub_account_id='SUB-OTHER' WHERE id='PI-573'`).run(),/immutable/);
  db.sqlite.prepare(`UPDATE payment_instructions SET status='PAYMENT_APPROVAL_PENDING' WHERE id='PI-573'`).run();
  assert.throws(()=>db.sqlite.prepare(`UPDATE payment_instructions SET provider_account_snapshot='{"changed":true}' WHERE id='PI-573'`).run(),/immutable/);
});

test('P5.7.3 PI generation is asynchronous but payment submission remains fail-closed',()=>{
  const generateStart=operating.indexOf("if (body.action === 'GENERATE_PAYMENT_INSTRUCTION')");
  const submitStart=operating.indexOf("if (body.action === 'SUBMIT_PAYMENT_INSTRUCTION')");
  const generate=operating.slice(generateStart,submitStart);
  const submit=operating.slice(submitStart,operating.indexOf("if (body.action === 'CREATE_EXCEPTION')",submitStart));
  assert.doesNotMatch(generate,/E2PAY_SUBACCOUNT_MAPPING_REQUIRED/);
  assert.doesNotMatch(generate,/E2PAY_SUBACCOUNT_NOT_PROVISIONED/);
  assert.match(generate,/PI preparation is intentionally asynchronous/);
  assert.match(generate,/PROVIDER_PENDING/);
  assert.match(submit,/PAYMENT_READINESS_PENDING/);
  assert.match(submit,/PAYMENT_ROUTING_BOUND/);
  assert.match(submit,/providerAccountCredentialState/);
});

test('P5.7.3 exposes canonical client readiness independently of payment provider state',()=>{
  assert.match(readinessApi,/deriveClientReadiness/);
  assert.match(readinessApi,/payroll_submissions/);
  assert.match(readinessApi,/provider_provisioning_sessions/);
  assert.match(readinessApi,/credentialReady/);
  assert.match(ui,/Operational Readiness/);
  assert.match(ui,/Payment setup berjalan async/);
  assert.match(ui,/Client, employee, payroll calculation, dan konfigurasi EWA tetap dapat dilanjutkan/);
});
