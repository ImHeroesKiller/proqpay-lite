import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { disbursementIdentity, intentFromSource, publicDisbursementRequest } from '../functions/api/disbursement-request-core.js';
import { roleCanAction } from '../shared/authority-matrix.js';

const api=await readFile(new URL('../functions/api/disbursement-requests.js',import.meta.url),'utf8');

test('P5.7.4 supports exactly payroll-direct, payroll-corporate and EWA-direct intents',()=>{
  assert.equal(intentFromSource('PI','DIRECT_EMPLOYEE').ok,true);
  assert.equal(intentFromSource('PAYMENT_INSTRUCTION','CLIENT_ACCOUNT').ok,true);
  assert.equal(intentFromSource('EWA','DIRECT_EMPLOYEE').ok,true);
  assert.equal(intentFromSource('EWA','CLIENT_ACCOUNT').ok,false);
});

test('P5.7.4 deterministic identity locks settlement mode and source',async()=>{
  const base={orgId:'ORG',clientId:'CLI',sourceDocumentType:'PAYMENT_INSTRUCTION',sourceDocumentId:'PI-1',provider:'E2PAY',environment:'UAT',providerAccountId:'PPA-1',amount:100000,items:[{sourceItemId:'L1',beneficiaryHash:'H1',amount:100000}]};
  const direct=await disbursementIdentity({...base,destinationMode:'DIRECT_EMPLOYEE'});
  const corporate=await disbursementIdentity({...base,destinationMode:'CLIENT_ACCOUNT'});
  assert.notEqual(direct.routingHash,corporate.routingHash);
  assert.notEqual(direct.idempotencyKey,corporate.idempotencyKey);
  assert.match(direct.clientReference,/^PQP-DR-/);
});

test('P5.7.4 maker-checker keeps request with Processor and approval with Controller',()=>{
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','disbursement.request'),true);
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','disbursement.approve'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','disbursement.request'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','disbursement.approve'),true);
  assert.equal(roleCanAction('SUPER_ADMIN','disbursement.approve'),false);
});

test('P5.7.4 API derives amount and beneficiary from source documents, not request payload',()=>{
  assert.match(api,/payment_instruction_lines/);
  assert.match(api,/client_bank_accounts/);
  assert.match(api,/ewa_requests/);
  assert.match(api,/employee_bank_accounts/);
  assert.match(api,/SOURCE_READY_PI/);
  assert.match(api,/status\)!=='APPROVED'/);
  assert.match(api,/CORPORATE_BENEFICIARY_REQUIRED/);
  assert.match(api,/PAYMENT_READINESS_PENDING/);
  assert.match(api,/DISBURSEMENT_SETTLEMENT_STRATEGY_LOCKED/);
  assert.match(api,/SUBMIT_REQUEST/);
  assert.doesNotMatch(api,/body\?\.amount|body\.amount/);
  assert.doesNotMatch(api,/body\?\.account|body\.accountNumber/);
});

test('P5.7.4 public output exposes last4 only and never ciphertext/hash/IV',()=>{
  const output=publicDisbursementRequest({id:'DR-1',client_id:'CLI',provider:'E2PAY',provider_environment:'UAT',provider_sub_account_id_snapshot:'SUB-1234',purpose:'PAYROLL',destination_mode:'DIRECT_EMPLOYEE',beneficiary_type:'EMPLOYEE',source_document_type:'PAYMENT_INSTRUCTION',source_document_id:'PI-1',amount:100,currency:'IDR',recipient_count:1,status:'READY',client_reference:'REF',correlation_id:'CORR',created_at:'now'},[{id:'I1',sequence_no:1,source_item_type:'PAYMENT_INSTRUCTION_LINE',source_item_id:'L1',beneficiary_type:'EMPLOYEE',beneficiary_reference:'E1',employee_id:'E1',bank_code:'BCA',bank_name:'BCA',beneficiary_name:'Employee',account_number_ciphertext:'SECRET-CIPHER',account_number_iv:'SECRET-IV',account_number_hash:'SECRET-HASH',account_number_last4:'1234',amount:100,currency:'IDR',status:'CREATED',client_reference:'REF-1'}]);
  assert.equal(output.items[0].accountLast4,'1234');
  const json=JSON.stringify(output);
  assert.doesNotMatch(json,/SECRET-CIPHER|SECRET-IV|SECRET-HASH/);
});

test('P5.7.4 READY request freezes business intent and beneficiary snapshot',()=>{
  const db=new D1Mock();
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-574','MSG','M574');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-574','ORG-574','C574','Client','ACTIVE');
    INSERT INTO employees(id,org_id,client_id,employee_code,name,status_aktif) VALUES('EMP-574','ORG-574','CLI-574','E574','Employee','ACTIVE');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,account_name,status,created_by)
      VALUES('PPA-574','ORG-574','CLI-574','E2PAY','UAT','SUB_ACCOUNT','SUB-574','Client','ACTIVE','seed');
    INSERT INTO disbursement_requests(id,org_id,client_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,amount,recipient_count,client_reference,correlation_id,idempotency_key,routing_hash,status,created_by_email)
      VALUES('DR-574','ORG-574','CLI-574','E2PAY','PPA-574','SUB-574','UAT','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE','PAYMENT_INSTRUCTION','PI-574',100000,1,'REF-574','CORR-574','IDEM-574','HASH-574','READY','processor@test');
    INSERT INTO disbursement_request_items(id,disbursement_request_id,sequence_no,source_item_type,source_item_id,beneficiary_type,beneficiary_reference,employee_id,bank_code,beneficiary_name,account_number_ciphertext,account_number_iv,account_number_hash,account_number_last4,beneficiary_hash,amount,client_reference)
      VALUES('DRI-574','DR-574',1,'PAYMENT_INSTRUCTION_LINE','L-574','EMPLOYEE','EMP-574','EMP-574','BCA','Employee','cipher','iv','accthash','1234','benhash',100000,'REF-574-1');
  `);
  assert.throws(()=>db.sqlite.exec("UPDATE disbursement_requests SET amount=1 WHERE id='DR-574'"),/immutable/);
  assert.throws(()=>db.sqlite.exec("UPDATE disbursement_request_items SET amount=1 WHERE id='DRI-574'"),/immutable/);
  assert.throws(()=>db.sqlite.exec("DELETE FROM disbursement_request_items WHERE id='DRI-574'"),/cannot be deleted/);
});
