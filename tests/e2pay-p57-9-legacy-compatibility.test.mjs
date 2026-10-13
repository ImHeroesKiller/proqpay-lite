import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { D1Mock } from './helpers/d1-mock.mjs';
import { manualCredentialBindingAllowed, legacyCredentialRecoveryState } from '../functions/api/e2pay-credential-lifecycle.js';

const migration=await readFile(new URL('../migrations/0065_p57_legacy_compatibility.sql',import.meta.url),'utf8');
const subaccountApi=await readFile(new URL('../functions/api/e2pay-subaccounts.js',import.meta.url),'utf8');
const compatibilityApi=await readFile(new URL('../functions/api/legacy-compatibility.js',import.meta.url),'utf8');
const directory=await readFile(new URL('../src/components/DirectoryManager.tsx',import.meta.url),'utf8');
const settings=await readFile(new URL('../src/components/LegacyCompatibilityPanel.tsx',import.meta.url),'utf8');

test('P5.7.9 migration creates compatibility ledger and backfills legacy provider sessions without recreating subaccounts',()=>{
  const db=new D1Mock();
  assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='legacy_compatibility_records'").get());
  const cols=db.sqlite.prepare('PRAGMA table_info(legacy_compatibility_records)').all().map(r=>r.name);
  for(const c of ['resource_type','classification','compatibility_status','resolution_strategy','safe_detail_json','resolved_at']) assert.ok(cols.includes(c),c);
  assert.match(migration,/INSERT OR IGNORE INTO provider_provisioning_sessions/);
  assert.match(migration,/LEGACY_CREDENTIAL_RECOVERY_REQUIRED/);
  assert.match(migration,/RECOVER_EXISTING_SUBACCOUNT_CREDENTIAL_ONCE_NO_RECREATE/);
  assert.doesNotMatch(migration,/INSERT(?: OR IGNORE)? INTO payment_provider_accounts/i);
});

test('P5.7.9 legacy manual recovery is allowed once and service-managed lifecycle locks it afterwards',()=>{
  assert.equal(manualCredentialBindingAllowed(null),true);
  assert.equal(manualCredentialBindingAllowed({credential_mode:'SERVICE_MANAGED',credential_state:'LEGACY_MANUAL'}),true);
  assert.equal(manualCredentialBindingAllowed({credential_mode:'SERVICE_MANAGED',credential_state:'HEALTHY'}),false);
  assert.equal(legacyCredentialRecoveryState({credential_state:'LEGACY_MANUAL'},false),'LEGACY_CREDENTIAL_RECOVERY_REQUIRED');
  assert.equal(legacyCredentialRecoveryState({credential_state:'HEALTHY'},true),'READY');
});

test('P5.7.9 successful legacy bind promotes existing account to READY/HEALTHY and resolves compatibility record',()=>{
  const start=subaccountApi.indexOf("if(action==='BIND_SUBACCOUNT_CREDENTIAL')");
  const end=subaccountApi.indexOf("if(action==='SYNC_BALANCE')",start);
  const block=subaccountApi.slice(start,end);
  assert.match(block,/providerAccountId!==clean\(current\.provider_sub_account_id/);
  assert.match(block,/state='READY',credential_state='HEALTHY'/);
  assert.match(block,/LEGACY_CREDENTIAL_RECOVERY_REQUIRED/);
  assert.match(block,/E2PAY_LEGACY_CREDENTIAL_RECOVERED/);
  assert.doesNotMatch(block,/REGISTER_SUBACCOUNT|e2payRegisterRequest|e2payRegisterConfirm/);
});

test('P5.7.9 compatibility audit never canonical-reexecutes legacy financial activity',()=>{
  assert.match(compatibilityApi,/LEGACY_FINANCIAL_IN_FLIGHT_RETAIN/);
  assert.match(compatibilityApi,/FINISH_AND_RECONCILE_IN_LEGACY_PIPELINE_NO_CANONICAL_REEXECUTION/);
  assert.match(compatibilityApi,/LEGACY_GATEWAY_IN_FLIGHT/);
  assert.match(compatibilityApi,/LEGACY_RECONCILIATION_ONLY_NO_CANONICAL_RETRY/);
  assert.match(compatibilityApi,/CANONICAL_DR_ELIGIBLE/);
  assert.match(compatibilityApi,/gateway_count/);
  assert.doesNotMatch(compatibilityApi,/UPDATE e2pay_disbursement_limit_usage SET status='RELEASED'/);
});

test('P5.7.9 flags deterministic orphan limit and legacy corporate beneficiary for review, not auto mutation',()=>{
  assert.match(compatibilityApi,/LEGACY_LIMIT_RESERVATION_REVIEW_REQUIRED/);
  assert.match(compatibilityApi,/CONTROLLER_REVIEW_BEFORE_RELEASE_NO_AUTOMATIC_MUTATION/);
  assert.match(compatibilityApi,/LEGACY_CORPORATE_BENEFICIARY_REVIEW_REQUIRED/);
  assert.match(compatibilityApi,/REVERIFY_THROUGH_P5_7_7_MAKER_CHECKER/);
});

test('GT5 legacy recovery is not exposed in client directory',()=>{ assert.doesNotMatch(ui,/Migrasikan Credential Legacy|Legacy credential recovery/); });

