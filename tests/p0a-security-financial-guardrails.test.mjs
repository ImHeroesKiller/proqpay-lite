import assert from 'node:assert/strict';
import test from 'node:test';
import { D1Mock } from './helpers/d1-mock.mjs';
import { createSession } from '../functions/api/_account-auth.js';
import { onRequest as bank } from '../functions/api/client-bank-beneficiaries.js';
import { onRequest as dr } from '../functions/api/disbursement-requests.js';
import { onRequest as executions } from '../functions/api/disbursement-executions.js';
import { onRequest as register } from '../functions/api/canonical-transaction-register.js';
import { onRequest as channels } from '../functions/api/provider-channel-mappings.js';
import { onRequest as ewa } from '../functions/api/ewa.js';
import { legacyGatewayForPi,canonicalDrForPi } from '../functions/api/_payment-source-guard.js';
import { readProviderFundingState } from '../functions/api/e2pay-disbursement-limit-core.js';

function fixture(){
  const DB=new D1Mock();
  DB.sqlite.exec(`
    INSERT INTO organizations(id,name,code) VALUES('ORG-P0A','Test','P0A');
    INSERT INTO clients(id,org_id,code,name,status) VALUES('C-P0A-A','ORG-P0A','A','Client A','ACTIVE'),('C-P0A-B','ORG-P0A','B','Client B','ACTIVE');
    INSERT INTO app_users(id,org_id,name,email,role,status,password_hash,password_salt,password_iterations,must_change_password,payment_approver,created_by)
      VALUES('U-P0A-C','ORG-P0A','Client','client@p0a.test','CLIENT_USER','ACTIVE','hash','salt',100000,0,0,'seed'),
      ('U-P0A-S','ORG-P0A','Admin','admin@p0a.test','SUPER_ADMIN','ACTIVE','hash','salt',100000,0,0,'seed');
    INSERT INTO payment_provider_accounts(id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,account_name,status,created_by)
      VALUES('PPA-P0A','ORG-P0A','C-P0A-A','E2PAY','UAT','SUB_ACCOUNT','SUB-P0A','A','ACTIVE','seed');
    INSERT INTO client_service_plans(id,client_id,tier,status,effective_from,created_by)
      VALUES('SP-P0A','C-P0A-A','STANDARD','ACTIVE','2026-01-01','seed');
    INSERT INTO payroll_submissions(id,org_id,client_id,service_plan_id,service_tier,period,state,created_by)
      VALUES('PS-P0A','ORG-P0A','C-P0A-A','SP-P0A','STANDARD','2026-10','PAYMENT_APPROVAL_PENDING','seed');
    INSERT INTO payment_instructions(id,org_id,client_id,submission_id,status,expected_total,creator_user_id,idempotency_key,recipient_count)
      VALUES('PI-P0A','ORG-P0A','C-P0A-A','PS-P0A','APPROVED_FOR_PAYMENT',100,'U-P0A-S','PIID-P0A',1);
  `);
  const env={DB,DEFAULT_ORG_ID:'ORG-P0A',AUTH_MODE:'session',SESSION_SECRET:'p0a-session-secret-at-least-32-chars',SECURITY_MFA_ENFORCEMENT:'AUDIT'};
  return {DB,env};
}
function gatewayRow(id='TX-P0A'){
  return `INSERT INTO payment_gateway_transactions(id,org_id,client_id,payment_instruction_id,provider,status,amount,idempotency_key,request_hash,created_by)
    VALUES('${id}','ORG-P0A','C-P0A-A','PI-P0A','E2PAY','CREATED',100,'IDEM-${id}','HASH','seed')`;
}
function canonicalRow(id='DR-P0A',type='PAYMENT_INSTRUCTION',sourceId='PI-P0A'){
  return `INSERT INTO disbursement_requests(id,org_id,client_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,amount,recipient_count,client_reference,correlation_id,idempotency_key,routing_hash,status,created_by_email)
    VALUES('${id}','ORG-P0A','C-P0A-A','E2PAY','PPA-P0A','SUB-P0A','UAT','${type==='EWA_REQUEST'?'EWA':'PAYROLL'}','DIRECT_EMPLOYEE','EMPLOYEE','${type}','${sourceId}',100,1,'REF-${id}','CORR-${id}','IDEM-${id}','HASH-${id}','READY','processor@test')`;
}

test('P0.A CLIENT_USER cannot list canonical transactions, executions, channels or another client bank data',async()=>{
  const {DB,env}=fixture();
  const session=await createSession(DB,'U-P0A-C',env);
  for(const [name,api,path] of [
    ['corporate bank',bank,'/api/client-bank-beneficiaries?clientId=C-P0A-B'],
    ['canonical requests',dr,'/api/disbursement-requests'],
    ['execution ledger',executions,'/api/disbursement-executions'],
    ['transaction register',register,'/api/canonical-transaction-register'],
    ['provider routing',channels,'/api/provider-channel-mappings'],
  ]){
    const response=await api({request:new Request('https://proqpay.test'+path,{headers:{Cookie:`proqpay_session=${session.token}`}}),env});
    assert.equal(response.status,403,`${name}: ${await response.clone().text()}`);
  }
});

test('P0.A legacy transaction blocks new canonical DR at SQLite write boundary',async()=>{
  const {DB}=fixture();
  DB.sqlite.exec(gatewayRow());
  assert.throws(()=>DB.sqlite.exec(canonicalRow()),/PAYMENT_SOURCE_ALREADY_EXECUTED_IN_LEGACY/);
  const existing=await legacyGatewayForPi(DB,'ORG-P0A','PI-P0A');
  assert.equal(existing.id,'TX-P0A');
});

test('P0.A canonical DR blocks new legacy gateway transaction even when gateway request raced after read',async()=>{
  const {DB}=fixture();
  DB.sqlite.exec(canonicalRow());
  assert.throws(()=>DB.sqlite.exec(gatewayRow()),/PAYMENT_SOURCE_CANONICAL_STRATEGY_LOCKED/);
  const existing=await canonicalDrForPi(DB,'ORG-P0A','PI-P0A');
  assert.equal(existing.id,'DR-P0A');
});

test('P0.A terminal legacy gateway transaction still blocks canonical replay',()=>{
  const {DB}=fixture();
  DB.sqlite.exec(gatewayRow());
  DB.sqlite.exec("UPDATE payment_gateway_transactions SET status='FAILED' WHERE id='TX-P0A'");
  assert.throws(()=>DB.sqlite.exec(canonicalRow()),/PAYMENT_SOURCE_ALREADY_EXECUTED_IN_LEGACY/);
});

test('P0.A EWA status update cannot bypass an active canonical DR',()=>{
  const {DB}=fixture();
  DB.sqlite.exec(`INSERT INTO employees(id,org_id,client_id,employee_code,name,status_aktif) VALUES('EMP-P0A','ORG-P0A','C-P0A-A','EP0A','Test','ACTIVE');
    INSERT INTO ewa_requests(id,org_id,client_id,employee_id,period,amount,status) VALUES('EWA-P0A','ORG-P0A','C-P0A-A','EMP-P0A','2026-10',100,'APPROVED');`);
  DB.sqlite.exec(canonicalRow('DR-EWA-P0A','EWA_REQUEST','EWA-P0A'));
  assert.throws(()=>DB.sqlite.exec("UPDATE ewa_requests SET status='DISBURSED' WHERE id='EWA-P0A'"),/EWA_CANONICAL_DISBURSEMENT_REQUIRED/);
});

test('P0.A historical paid EWA is never allowed to spawn a new canonical disbursement',()=>{
  const {DB}=fixture();
  DB.sqlite.exec(`INSERT INTO employees(id,org_id,client_id,employee_code,name,status_aktif) VALUES('EMP-HIST','ORG-P0A','C-P0A-A','H001','Employee','ACTIVE');
    INSERT INTO ewa_requests(id,org_id,client_id,employee_id,period,amount,status) VALUES('EWA-HIST','ORG-P0A','C-P0A-A','EMP-HIST','2026-09',100,'DISBURSED');`);
  assert.throws(()=>DB.sqlite.exec(canonicalRow('DR-HIST','EWA_REQUEST','EWA-HIST')),/EWA_ALREADY_PAID_IN_LEGACY/);
});

test('P0.A legacy EWA DISBURSE API is fail-closed even for Super Admin until controlled canonical UI is wired',async()=>{
  const {DB,env}=fixture();
  const session=await createSession(DB,'U-P0A-S',env);
  const response=await ewa({request:new Request('https://proqpay.test/api/ewa',{method:'POST',headers:{Cookie:`proqpay_session=${session.token}`,Origin:'https://proqpay.test','Content-Type':'application/json'},body:JSON.stringify({action:'DISBURSE',id:'ANY'})}),env});
  assert.equal(response.status,409,await response.clone().text());
  assert.equal((await response.json()).code,'EWA_CANONICAL_EXECUTION_REQUIRED');
});

test('P0.A funding readiness fails closed when parent balance is missing, despite fresh subclient & limit',async()=>{
  const {DB}=fixture();
  const now=new Date().toISOString();
  DB.sqlite.prepare('UPDATE payment_provider_accounts SET balance=10000,available_balance=10000,last_balance_sync_at=? WHERE id=?').run(now,'PPA-P0A');
  DB.sqlite.exec(`INSERT INTO e2pay_disbursement_limit_requests(id,org_id,provider_account_registry_id,client_id,environment,requested_amount,approved_amount,status,requested_by_email,approved_by_email,approved_at)
    VALUES('DLR-P0A','ORG-P0A','PPA-P0A','C-P0A-A','UAT',5000,5000,'ACTIVE','maker','controller','2026-10-12T00:00:00Z')`);
  const funding=await readProviderFundingState(DB,'ORG-P0A','PPA-P0A',100);
  assert.equal(funding.parent.ready,false);
  assert.equal(funding.subClient.ready,true);
  assert.equal(funding.limit.ready,true);
  assert.equal(funding.ready,false);
  assert.equal(funding.state,'PARENT_NOT_SYNCED');
});
