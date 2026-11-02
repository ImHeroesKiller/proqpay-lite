import test from 'node:test';
import assert from 'node:assert/strict';
import {masterFixture,roleSession,mockProvider} from './helpers/e2pay-master-fixture.mjs';
import {onRequest} from '../functions/api/e2pay-operations.js';
import {activateGatewaySecureSettings} from '../functions/api/payment-gateway-settings-store.js';

test('Master balance refresh reads account independently of bank catalogue availability',async t=>{
  const f=masterFixture();
  const headers=await roleSession(f,'PAYROLL_PROCESSOR');
  const provider=mockProvider(t);
  const response=await onRequest({request:new Request('https://proqpay.test/api/e2pay-operations?resource=account&refresh=1',{headers}),env:f.env});
  assert.equal(response.status,200,await response.clone().text());
  const data=await response.json();
  assert.equal(data.account.available,true);
  assert.equal(data.account.balance,1e9);
  assert.ok(data.account.refreshedAt);
  assert.equal(provider.calls.filter(c=>c.path==='/switching/b2b/bank/sdp').length,0);
  assert.equal(provider.posts().length,0);
  assert.equal(f.database.sqlite.prepare('SELECT COUNT(*) AS n FROM e2pay_disbursement_limit_requests').get().n,0);
});

test('Unreadable encrypted gateway configuration returns actionable failure without provider calls or data replacement',async t=>{
  const f=masterFixture();
  await activateGatewaySecureSettings(f.database,f.env,'ORG-FIX','admin@test',{provider:'E2PAY',environment:'UAT',credentials:{clientId:'test-client',clientSecret:'test-secret'}});
  const before=f.database.sqlite.prepare('SELECT credentials_ciphertext,credentials_iv,credential_version FROM gateway_secure_settings').get();
  const headers=await roleSession(f,'PAYROLL_PROCESSOR');
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected provider request');});
  const response=await onRequest({request:new Request('https://proqpay.test/api/e2pay-operations?resource=account&refresh=1',{headers}),env:{...f.env,PI_ENCRYPTION_KEY:'different-test-key-at-least-32-characters-long'}});
  assert.equal(response.status,503);
  const data=await response.json();
  assert.equal(data.code,'E2PAY_CREDENTIALS_UNREADABLE');
  assert.equal(data.stage,'CONFIGURATION');
  assert.match(data.error,/kunci enkripsi/);
  assert.ok(data.correlationId);
  assert.doesNotMatch(JSON.stringify(data),/test-secret|different-test-key|ciphertext|credentials_iv/);
  assert.equal(calls,0);
  const evidence=f.database.sqlite.prepare("SELECT detail,correlation_id FROM audit_logs WHERE action='E2PAY_OPERATION_FAILED'").get();
  assert.equal(evidence.correlation_id,data.correlationId);
  assert.equal(JSON.parse(evidence.detail).code,'E2PAY_CREDENTIALS_UNREADABLE');
  assert.doesNotMatch(evidence.detail,/test-secret|different-test-key|ciphertext|credentials_iv/);
  assert.deepEqual(f.database.sqlite.prepare('SELECT credentials_ciphertext,credentials_iv,credential_version FROM gateway_secure_settings').get(),before);
  assert.equal(f.database.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_gateway_provider_snapshots').get().n,0);
});
