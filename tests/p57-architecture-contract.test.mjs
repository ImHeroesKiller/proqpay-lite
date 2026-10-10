import assert from 'node:assert/strict';
import test from 'node:test';
import { D1Mock } from './helpers/d1-mock.mjs';
import { roleCanAction } from '../shared/authority-matrix.js';
import {
  DISBURSEMENT_INTENTS,
  canTransitionDisbursement,
  providerChannelKey,
  validateDisbursementIntent,
} from '../shared/disbursement-contract.js';

function seed(db){
  db.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-P57','ProQPay','P57');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('CLI-P57','ORG-P57','P57C','Client P57','ACTIVE');
    INSERT INTO employees(id,org_id,client_id,employee_code,name,status_aktif) VALUES('EMP-P57','ORG-P57','CLI-P57','P57-1','Employee P57','ACTIVE');
    INSERT INTO payment_provider_accounts(
      id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,
      account_name,status,created_by
    ) VALUES('PPA-P57','ORG-P57','CLI-P57','E2PAY','UAT','SUB_ACCOUNT','SUB-P57-001','Client P57','ACTIVE','seed');
  `);
}

function createRequest(db,overrides={}){
  const row={
    id:'DR-P57-1',org:'ORG-P57',client:'CLI-P57',provider:'E2PAY',account:'PPA-P57',
    sub:'SUB-P57-001',env:'UAT',purpose:'PAYROLL',destination:'DIRECT_EMPLOYEE',
    beneficiary:'EMPLOYEE',sourceType:'PAYMENT_INSTRUCTION',sourceId:'PI-P57-1',
    amount:1000000,count:1,clientRef:'PQP-DR-P57-1',correlation:'CORR-P57-1',
    idem:'IDEM-P57-1',routing:'HASH-P57-1',status:'DRAFT',createdBy:'processor@test',
    ...overrides,
  };
  db.sqlite.prepare(`
    INSERT INTO disbursement_requests(
      id,org_id,client_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,
      provider_environment,purpose,destination_mode,beneficiary_type,source_document_type,
      source_document_id,amount,recipient_count,client_reference,correlation_id,idempotency_key,
      routing_hash,status,created_by_email
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(row.id,row.org,row.client,row.provider,row.account,row.sub,row.env,row.purpose,row.destination,
    row.beneficiary,row.sourceType,row.sourceId,row.amount,row.count,row.clientRef,row.correlation,
    row.idem,row.routing,row.status,row.createdBy);
  return row;
}

test('P5.7.0 defines exactly the three approved canonical disbursement intents',()=>{
  assert.deepEqual(Object.keys(DISBURSEMENT_INTENTS),[
    'PAYROLL_DIRECT_EMPLOYEE','PAYROLL_CLIENT_ACCOUNT','EWA_DIRECT_EMPLOYEE',
  ]);
  assert.equal(validateDisbursementIntent(DISBURSEMENT_INTENTS.PAYROLL_DIRECT_EMPLOYEE).ok,true);
  assert.equal(validateDisbursementIntent(DISBURSEMENT_INTENTS.PAYROLL_CLIENT_ACCOUNT).ok,true);
  assert.equal(validateDisbursementIntent(DISBURSEMENT_INTENTS.EWA_DIRECT_EMPLOYEE).ok,true);
  assert.equal(validateDisbursementIntent({
    purpose:'EWA',destinationMode:'CLIENT_ACCOUNT',beneficiaryType:'CORPORATE',sourceDocumentType:'EWA_REQUEST',
  }).ok,false);
  assert.equal(providerChannelKey(DISBURSEMENT_INTENTS.PAYROLL_DIRECT_EMPLOYEE),'PAYROLL:DIRECT_EMPLOYEE:EMPLOYEE');
});

test('P5.7.0 authority preserves maker-checker without Super Admin financial approval bypass',()=>{
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','disbursement.request'),true);
  assert.equal(roleCanAction('PAYROLL_PROCESSOR','disbursement.approve'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','disbursement.request'),false);
  assert.equal(roleCanAction('PAYROLL_CONTROLLER','disbursement.approve'),true);
  assert.equal(roleCanAction('SUPER_ADMIN','disbursement.approve'),false);
});

test('P5.7.0 canonical state contract allows approval path and blocks terminal reopening',()=>{
  assert.equal(canTransitionDisbursement('DRAFT','READY'),true);
  assert.equal(canTransitionDisbursement('READY','PENDING_APPROVAL'),true);
  assert.equal(canTransitionDisbursement('PENDING_APPROVAL','APPROVED'),true);
  assert.equal(canTransitionDisbursement('APPROVED','EXECUTING'),true);
  assert.equal(canTransitionDisbursement('SETTLED','RECONCILED'),true);
  assert.equal(canTransitionDisbursement('RECONCILED','READY'),false);
  assert.equal(canTransitionDisbursement('REJECTED','APPROVED'),false);
});

test('P5.7.0 schema is additive and creates provisioning, channel, beneficiary and disbursement foundations',()=>{
  const db=new D1Mock();
  const required=[
    'provider_provisioning_sessions','client_bank_accounts','provider_channel_mappings',
    'disbursement_requests','disbursement_request_items',
  ];
  for(const name of required){
    assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name),name);
  }
  const gatewayColumns=db.sqlite.prepare('PRAGMA table_info(payment_gateway_transactions)').all();
  assert.ok(gatewayColumns.some((row)=>row.name==='disbursement_request_id'));
});

test('P5.7.0 provider channel mapping does not invent E2Pay channel codes',()=>{
  const db=new D1Mock();
  seed(db);
  assert.throws(()=>db.sqlite.prepare(`
    INSERT INTO provider_channel_mappings(
      id,provider,environment,purpose,destination_mode,beneficiary_type,
      provider_channel,mapping_status,created_by
    ) VALUES('PCM-BAD','E2PAY','UAT','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE',NULL,'ACTIVE','seed')
  `).run(),/CHECK constraint failed/);
  assert.doesNotThrow(()=>db.sqlite.prepare(`
    INSERT INTO provider_channel_mappings(
      id,provider,environment,purpose,destination_mode,beneficiary_type,
      provider_channel,mapping_status,created_by
    ) VALUES('PCM-PENDING','E2PAY','UAT','PAYROLL','DIRECT_EMPLOYEE','EMPLOYEE',NULL,'PENDING_PROVIDER_CONFIRMATION','seed')
  `).run());
});

test('P5.7.0 one source document cannot have two concurrent settlement strategies',()=>{
  const db=new D1Mock(); seed(db);
  createRequest(db);
  assert.throws(()=>createRequest(db,{
    id:'DR-P57-2',destination:'CLIENT_ACCOUNT',beneficiary:'CORPORATE',
    clientRef:'PQP-DR-P57-2',correlation:'CORR-P57-2',idem:'IDEM-P57-2',routing:'HASH-P57-2',
  }),/UNIQUE constraint failed/);
});

test('P5.7.0 approval freezes request and beneficiary routing snapshots',()=>{
  const db=new D1Mock(); seed(db);
  createRequest(db);
  db.sqlite.prepare(`
    INSERT INTO employee_bank_accounts(id,employee_id,bank_name,account_no,is_primary)
    VALUES('EBA-P57','EMP-P57','Bank Test','1234567890',1)
  `).run();
  db.sqlite.prepare(`
    INSERT INTO disbursement_request_items(
      id,disbursement_request_id,sequence_no,source_item_type,source_item_id,beneficiary_type,
      beneficiary_reference,employee_id,bank_code,bank_name,beneficiary_name,
      account_number_ciphertext,account_number_iv,account_number_hash,account_number_last4,
      beneficiary_hash,amount,client_reference
    ) VALUES(
      'DRI-P57','DR-P57-1',1,'PAYMENT_INSTRUCTION_LINE','PIL-P57-1','EMPLOYEE',
      'EMP-P57','EMP-P57','TEST','Bank Test','Employee P57',
      'cipher','iv','acct-hash','7890','beneficiary-hash',1000000,'PQP-DRI-P57-1'
    )
  `).run();
  db.sqlite.prepare(`
    UPDATE disbursement_requests
    SET status='APPROVED',approved_by_email='controller@test',approved_at='2026-10-10T00:00:00Z'
    WHERE id='DR-P57-1'
  `).run();
  assert.throws(()=>db.sqlite.prepare(
    "UPDATE disbursement_requests SET provider_sub_account_id_snapshot='OTHER' WHERE id='DR-P57-1'"
  ).run(),/Ready disbursement business intent is immutable|Approved disbursement routing is immutable/);
  assert.throws(()=>db.sqlite.prepare(
    "UPDATE disbursement_request_items SET amount=900000 WHERE id='DRI-P57'"
  ).run(),/Ready disbursement beneficiary snapshot is immutable|Approved disbursement beneficiary snapshot is immutable/);
});

test('P5.7.0 corporate account requires encrypted storage and verified primary uniqueness',()=>{
  const db=new D1Mock(); seed(db);
  const insert=(id,hash,last4)=>db.sqlite.prepare(`
    INSERT INTO client_bank_accounts(
      id,org_id,client_id,bank_code,account_name,account_number_ciphertext,account_number_iv,
      account_number_hash,account_number_last4,status,is_primary,verified_by_email,verified_at,
      created_by_email
    ) VALUES(?,?,?,?,?,?,?,?,?,'VERIFIED',1,'controller@test','2026-10-10T00:00:00Z','processor@test')
  `).run(id,'ORG-P57','CLI-P57','TEST','Client P57','cipher','iv',hash,last4);
  insert('CBA-P57-1','hash-1','1111');
  assert.throws(()=>insert('CBA-P57-2','hash-2','2222'),/UNIQUE constraint failed/);
});
