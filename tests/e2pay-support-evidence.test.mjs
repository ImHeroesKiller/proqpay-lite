import test from 'node:test';
import assert from 'node:assert/strict';
import {buildE2PaySupportEvidence} from '../shared/e2pay-support-evidence.js';

const request={id:'DR-1',clientReference:'PQP-DR-1',environment:'UAT',provider:'E2PAY',sourceDocumentType:'PAYMENT_INSTRUCTION',sourceDocumentId:'PI-1',status:'RECONCILED',amount:30000,recipientCount:2,secret:'do-not-export'};
const execution={id:'DX-1',disbursement_request_id:'DR-1',status:'SUCCEEDED',currency:'IDR',execution_lock_token:'private-lock',request_hash:'private-hash'};
const item={disbursement_execution_id:'DX-1',client_ref:'REF-1',status:'SUCCEEDED',amount:15000,fee_amount:2500,response_code:'00',response_message:'Success',journal_id:'JOURNAL-1',provider_transaction_id:'TX-1',account_last4:'1234',account_number:'private-account',requestDiagnostics:{password:'private-password'},attempt_count:1};

test('support JSON preserves provider reference and result, separates fees and identifies UAT / stored summary',()=>{
  const result=buildE2PaySupportEvidence(request,execution,[item,{...item,client_ref:'REF-2',journal_id:'JOURNAL-2'}]);
  assert.equal(result.environment,'UAT');
  assert.equal(result.evidenceType,'STORED_EXECUTION_SUMMARY');
  assert.equal(result.sourceDocumentId,'PI-1');
  assert.equal(result.recipients[0].responseCode,'00');
  assert.equal(result.recipients[0].journalId,'JOURNAL-1');
  assert.deepEqual(result.summary,{recordedRecipients:2,succeeded:2,failed:0,pending:0,recordedAmount:30000,recordedFeeAmount:5000});
  const serialized=JSON.stringify(result);
  for(const value of ['do-not-export','private-lock','private-hash','private-account','private-password'])assert.ok(!serialized.includes(value));
});

test('support evidence does not turn unknown or partial results into success',()=>{
  const result=buildE2PaySupportEvidence({...request,status:'RECONCILIATION_REQUIRED'},{...execution,status:'RECONCILIATION_REQUIRED'},[{...item,status:'UNKNOWN',response_code:null,journal_id:null},{...item,status:'FAILED',error_code:'PROVIDER_REJECTED'}]);
  assert.equal(result.summary.succeeded,0);assert.equal(result.summary.pending,1);assert.equal(result.summary.failed,1);
  assert.equal(result.recipients[0].responseCode,null);assert.equal(result.recipients[0].journalId,null);
  assert.equal(result.recipients[1].errorCode,'PROVIDER_REJECTED');
});

test('support evidence rejects stale or mismatched request and execution data',()=>{
  assert.throws(()=>buildE2PaySupportEvidence(request,{...execution,disbursement_request_id:'DR-OTHER'},[item]));
  assert.throws(()=>buildE2PaySupportEvidence(request,execution,[{...item,disbursement_execution_id:'DX-OTHER'}]));
  assert.throws(()=>buildE2PaySupportEvidence(request,null,[]));
});
