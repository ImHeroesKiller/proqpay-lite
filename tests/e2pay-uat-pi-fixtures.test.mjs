import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source=await readFile(new URL('../functions/api/e2pay-uat-fixtures.js',import.meta.url),'utf8');

test('E2Pay PI fixture generator is Super Admin and UAT gated',()=>{
  assert.match(source,/roles:\['SUPER_ADMIN'\]/);
  assert.match(source,/E2PAY_UAT_REQUIRED/);
  assert.match(source,/CREATE E2PAY UAT PI/);
  assert.match(source,/PAYMENT_GATEWAY_PROVIDER/);
  assert.match(source,/E2PAY_ENV/);
});

test('E2Pay PI fixtures create several low-value approved scenarios',()=>{
  assert.match(source,/SUB-E2PAY-UAT-001/);
  assert.match(source,/SUB-E2PAY-UAT-002/);
  assert.match(source,/SUB-E2PAY-UAT-003/);
  assert.match(source,/SUB-E2PAY-UAT-005/);
  assert.match(source,/amount:15000/);
  assert.match(source,/APPROVE_PAYMENT/);
  assert.match(source,/action:'APPROVE_PAYMENT'/);
});

test('E2Pay UAT fixtures use the provider dummy destination and do not auto execute',()=>{
  assert.match(source,/701075327/);
  assert.match(source,/PERMATA/);
  assert.doesNotMatch(source,/action:'EXECUTE'/);
  assert.match(source,/gatewayTransaction:gateway\|\|null/);
});
