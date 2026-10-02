import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { phaseFor } from '../functions/api/e2pay-uat-validation.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('P5.4 state machine gates on sub-account and liquidity before PI',()=>{
  assert.equal(phaseFor({account:null,liquidity:null,pi:null,transaction:null,items:[]}), 'WAITING_SUBACCOUNT');
  assert.equal(phaseFor({account:{id:'A'},liquidity:{ready:false},pi:null,transaction:null,items:[]}), 'WAITING_BALANCE');
  assert.equal(phaseFor({account:{id:'A'},liquidity:{ready:true},pi:null,transaction:null,items:[]}), 'READY_FOR_PI');
});

test('P5.4 state machine requires Controller approval before canary execution',()=>{
  const base={account:{id:'A'},liquidity:{ready:true},transaction:null,items:[]};
  assert.equal(phaseFor({...base,pi:{status:'PAYMENT_INSTRUCTION_READY'}}),'READY_FOR_PI_SUBMIT');
  assert.equal(phaseFor({...base,pi:{status:'PAYMENT_APPROVAL_PENDING'}}),'WAITING_CONTROLLER_APPROVAL');
  assert.equal(phaseFor({...base,pi:{status:'APPROVED_FOR_PAYMENT'}}),'READY_FOR_CANARY_EXECUTION');
});

test('P5.4 unknown provider result forces reconciliation before retry',()=>{
  const phase=phaseFor({
    account:{id:'A'},liquidity:{ready:true},pi:{status:'DISBURSEMENT_PROCESSING'},
    transaction:{status:'PROCESSING'},items:[{status:'UNKNOWN'}],
  });
  assert.equal(phase,'RECONCILE_REQUIRED');
});

test('P5.4 marks completed reconciled transaction as passed',()=>{
  const phase=phaseFor({
    account:{id:'A'},liquidity:{ready:true},pi:{status:'COMPLETED'},
    transaction:{status:'SUCCEEDED'},items:[{status:'SUCCEEDED'}],
  });
  assert.equal(phase,'PASSED');
});

test('P5.4 keeps raw disbursement disabled and uses normal Payment Control authority',async()=>{
  const [validation,operations,gateway,seed]=await Promise.all([
    read('functions/api/e2pay-uat-validation.js'),
    read('functions/api/e2pay-operations.js'),
    read('functions/api/payment-gateway.js'),
    read('ops/e2pay-uat-fresh-seed.sql'),
  ]);
  assert.match(validation,/financialExecutionRole:'PAYROLL_CONTROLLER'/);
  assert.match(validation,/rawDisbursementDisabled:true/);
  assert.match(operations,/E2PAY_PAYMENT_CONTROL_REQUIRED/);
  assert.match(gateway,/roles: request\.method === 'POST' \? \['PAYROLL_CONTROLLER'\]/);
  assert.match(seed,/SUB-E2PAY-UAT-CANARY-001/);
  assert.match(seed,/1 synthetic recipient, Rp15\.000/);
  assert.doesNotMatch(seed,/INSERT OR IGNORE INTO payment_gateway_transactions/);
  assert.doesNotMatch(seed,/INSERT OR IGNORE INTO payment_approvals/);
});