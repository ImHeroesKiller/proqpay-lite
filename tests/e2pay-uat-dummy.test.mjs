import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  E2PAY_UAT_DUMMY_DESTINATION,
  e2payEffectiveDestination,
} from '../functions/api/payment-gateway-e2pay.js';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('E2Pay UAT uses provider-approved Permata dummy destination from the SSD example',()=>{
  assert.deepEqual(E2PAY_UAT_DUMMY_DESTINATION,{bankId:'permata',accountId:'701075327'});
  assert.deepEqual(
    e2payEffectiveDestination({E2PAY_ENV:'UAT'},{accountNumber:'1234567890',amount:275000}),
    {accountId:'701075327',bankId:'permata',amount:275000,isUatDummy:true},
  );
});

test('E2Pay production never substitutes beneficiary bank account with the UAT dummy',()=>{
  assert.deepEqual(
    e2payEffectiveDestination({E2PAY_ENV:'PRODUCTION'},{accountNumber:'1234567890',amount:275000}),
    {accountId:'1234567890',bankId:null,amount:275000,isUatDummy:false},
  );
});

test('Payment Control UAT uses only dummy provider destination and strips beneficiary PII from financial POST description',async()=>{
  const source=await read('functions/api/payment-gateway-e2pay-service.js');
  assert.match(source,/e2payEffectiveDestination\(env,beneficiary\)/);
  assert.match(source,/returnedAccount !== effectiveDestination\.accountId/);
  assert.match(source,/Dummy bank Permata untuk E2Pay UAT/);
  assert.match(source,/\[UAT DUMMY\]/);
  assert.match(source,/uatDummy\s*\? '\[UAT DUMMY\] '/);
  assert.match(source,/String\(item\.client_ref \|\| ''\)\.slice\(-8\)/);
  assert.match(source,/: \(payment\.document_no \|\| payment\.id\) \+ ' ' \+ beneficiary\.beneficiaryName/);
});

test('Integration console clearly exposes the provider UAT rule without treating Permata as wallet funding',async()=>{
  const source=await read('src/components/E2PayOperationsConsole.tsx');
  assert.match(source,/accountId:'701075327'/);
  assert.match(source,/bankId:'permata'/);
  assert.match(source,/E2Pay UAT dummy destination/);
  assert.match(source,/Gunakan dummy UAT/);
  assert.match(source,/Nominal Rp15\.000 berasal dari contoh dokumen/);
  assert.match(source,/Permata 701075327 bukan VA Top Up/);
});
