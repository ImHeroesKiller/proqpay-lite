import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionContentHash} from '../functions/api/payment-instruction-core.js';
import {verifyStoredInstructionHash} from '../functions/api/payment-instruction-integrity.js';
const lines=[{employeeId:'E1',beneficiaryName:'Synthetic recipient',bankName:'BCA',bankCode:'BCA',accountNumber:'1234567890',amount:1000}];
const metadata={organizationId:'ORG',clientId:'CLIENT',submissionId:'SUB',payrollPeriod:'2026-10',paymentPeriod:'2026-10'};
async function fixture(bound=true){
 const payment={id:'PI',org_id:'ORG',client_id:'CLIENT',submission_id:'SUB',payroll_period:'2026-10',payment_period:'2026-10',provider:'E2PAY',provider_environment:'UAT',provider_account_registry_id:'MASTER',provider_account_snapshot:JSON.stringify({registryId:'MASTER',provider:'E2PAY',environment:'UAT'}),content_hash:await instructionContentHash(metadata,lines)};
 const database={prepare(sql){assert.match(sql,/PAYMENT_ROUTING_BOUND/);return {bind(org,id){assert.equal(org,'ORG');assert.equal(id,'PI');return {async first(){return bound?{id:'AUDIT'}:null;}};}};}};
 return {payment,database};
}
test('audited deferred activation preserves the original content commitment while verifying routing separately',async()=>{
 const {payment,database}=await fixture();const verified=await verifyStoredInstructionHash(database,payment,lines);
 assert.equal(verified.valid,true);assert.equal(verified.mode,'DEFERRED_ROUTING_AUDITED');assert.equal(verified.hash,payment.content_hash);assert.notEqual(verified.routedHash,verified.hash);
});
test('deferred hash cannot be accepted without server routing evidence',async()=>{
 const {payment,database}=await fixture(false);assert.equal((await verifyStoredInstructionHash(database,payment,lines)).valid,false);
});
for(const mutation of ['amount','accountNumber','beneficiaryName'])test(`deferred commitment rejects changed ${mutation}`,async()=>{
 const {payment,database}=await fixture();const changed=[{...lines[0],[mutation]:mutation==='amount'?1001:'changed'}];assert.equal((await verifyStoredInstructionHash(database,payment,changed)).valid,false);
});
test('deferred routing rejects mismatched snapshot registry and environment',async()=>{
 const {payment,database}=await fixture();for(const value of [{registryId:'OTHER',provider:'E2PAY',environment:'UAT'},{registryId:'MASTER',provider:'E2PAY',environment:'PRODUCTION'}])assert.equal((await verifyStoredInstructionHash(database,{...payment,provider_account_snapshot:JSON.stringify(value)},lines)).valid,false);
});
test('fully bound snapshots require their exact routed hash',async()=>{
 const {payment,database}=await fixture(false);payment.content_hash=await instructionContentHash({...metadata,provider:'E2PAY',providerEnvironment:'UAT',providerAccountRegistryId:'MASTER'},lines);assert.equal((await verifyStoredInstructionHash(database,payment,lines)).mode,'ROUTED');
});
