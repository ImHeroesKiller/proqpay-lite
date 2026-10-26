import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFixture,roleSession} from './helpers/e2pay-master-fixture.mjs';
import {onRequest} from '../functions/api/e2pay-disbursement-limits.js';

test('Controller can approve a second client on the same Master without losing duplicate or capacity guards',async()=>{
  const f=masterFixture();
  f.database.sqlite.exec(`
    INSERT INTO clients(id,org_id,code,name,status) VALUES('C-SECOND','ORG-FIX','SECOND','Second client','ACTIVE');
    INSERT INTO payment_gateway_provider_snapshots(org_id,provider,environment,account_id,merchant_status,balance,refreshed_at)
      VALUES('ORG-FIX','E2PAY','UAT','PROVIDER-MASTER','ACTIVE',1000000,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email)
      VALUES('FIRST','ORG-FIX','MASTER-FIX','C-FIX','UAT',700000,700000,'ACTIVE','processor@test'),
      ('SECOND','ORG-FIX','MASTER-FIX','C-SECOND','UAT',100000,NULL,'PENDING_APPROVAL','processor@test');
  `);
  const headers=await roleSession(f,'PAYROLL_CONTROLLER');
  const approve=()=>onRequest({request:new Request('https://proqpay.test/api/e2pay-disbursement-limits',{method:'POST',headers,body:JSON.stringify({action:'APPROVE_LIMIT',id:'SECOND'})}),env:f.env});
  let response=await approve();
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(f.database.sqlite.prepare("SELECT status FROM e2pay_disbursement_limit_requests WHERE id='SECOND'").get().status,'ACTIVE');
  assert.throws(()=>f.database.sqlite.exec(`INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email) VALUES('DUP','ORG-FIX','MASTER-FIX','C-SECOND','UAT',100000,100000,'ACTIVE','processor@test')`),/UNIQUE/);
  f.database.sqlite.exec("UPDATE e2pay_disbursement_limit_requests SET status='REJECTED',requested_amount=400000,approved_amount=NULL WHERE id='SECOND'; UPDATE e2pay_disbursement_limit_requests SET status='PENDING_APPROVAL' WHERE id='SECOND';");
  response=await approve();
  assert.equal(response.status,409,await response.clone().text());
  assert.equal((await response.json()).code,'MASTER_GLOBAL_CAPACITY_RECHECK_FAILED');
  assert.equal(f.database.sqlite.prepare("SELECT status FROM e2pay_disbursement_limit_requests WHERE id='SECOND'").get().status,'PENDING_APPROVAL');
});
