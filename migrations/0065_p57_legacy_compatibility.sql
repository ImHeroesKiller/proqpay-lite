PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legacy_compatibility_records (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('PROVIDER_ACCOUNT','PAYMENT_INSTRUCTION','GATEWAY_TRANSACTION','LIMIT_USAGE','CORPORATE_BENEFICIARY')),
  resource_id TEXT NOT NULL,
  classification TEXT NOT NULL,
  compatibility_status TEXT NOT NULL CHECK (compatibility_status IN ('OPEN','RECOVERY_REQUIRED','CANONICAL_ELIGIBLE','RETAIN_LEGACY','RESOLVED')),
  resolution_strategy TEXT NOT NULL,
  safe_detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(safe_detail_json)),
  first_detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(org_id,resource_type,resource_id,classification)
);

CREATE INDEX IF NOT EXISTS idx_legacy_compat_status
  ON legacy_compatibility_records(org_id,compatibility_status,resource_type,last_detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_legacy_compat_resource
  ON legacy_compatibility_records(org_id,resource_type,resource_id);

-- Backfill durable P5.7 provisioning sessions for already-provisioned legacy E2Pay
-- accounts. Missing credentials remain explicitly LEGACY_MANUAL so the existing
-- merchant can be recovered without recreating the provider sub-account.
INSERT OR IGNORE INTO provider_provisioning_sessions(
  id,org_id,client_id,project_id,provider,environment,provider_account_registry_id,
  state,credential_mode,provider_account_id,ready_at,created_by,updated_by,
  credential_state,credential_version,credential_last_validated_at
)
SELECT
  'PPS-LEGACY-' || ppa.id,
  ppa.org_id,ppa.client_id,ppa.project_id,ppa.provider,ppa.environment,ppa.id,
  CASE
    WHEN json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.ciphertext') IS NOT NULL
     AND json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.iv') IS NOT NULL THEN 'READY'
    ELSE 'MANUAL_REVIEW'
  END,
  'SERVICE_MANAGED',
  COALESCE(ppa.provider_account_id,ppa.provider_sub_account_id),
  CASE
    WHEN json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.ciphertext') IS NOT NULL
     AND json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.iv') IS NOT NULL THEN COALESCE(ppa.last_balance_sync_at,ppa.updated_at,ppa.created_at)
    ELSE NULL
  END,
  'P5.7.9_LEGACY_MIGRATION','P5.7.9_LEGACY_MIGRATION',
  CASE
    WHEN json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.ciphertext') IS NOT NULL
     AND json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.iv') IS NOT NULL THEN 'HEALTHY'
    ELSE 'LEGACY_MANUAL'
  END,
  CASE
    WHEN json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.ciphertext') IS NOT NULL
     AND json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.iv') IS NOT NULL THEN 1 ELSE 0
  END,
  CASE
    WHEN json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.ciphertext') IS NOT NULL
     AND json_extract(COALESCE(ppa.metadata_json,'{}'),'$.merchantCredential.iv') IS NOT NULL THEN COALESCE(ppa.last_balance_sync_at,ppa.updated_at,ppa.created_at)
    ELSE NULL
  END
FROM payment_provider_accounts ppa
WHERE ppa.provider='E2PAY'
  AND ppa.account_scope='SUB_ACCOUNT'
  AND ppa.status='ACTIVE'
  AND ppa.provider_sub_account_id IS NOT NULL
  AND COALESCE(ppa.provisioning_state,'PROVISIONED')='PROVISIONED';

INSERT OR IGNORE INTO legacy_compatibility_records(
  id,org_id,resource_type,resource_id,classification,compatibility_status,resolution_strategy,safe_detail_json
)
SELECT
  'LCR-PROVIDER-' || ppa.id,
  ppa.org_id,'PROVIDER_ACCOUNT',ppa.id,
  CASE
    WHEN pps.credential_state='LEGACY_MANUAL' THEN 'LEGACY_CREDENTIAL_RECOVERY_REQUIRED'
    ELSE 'LEGACY_PROVIDER_SESSION_BACKFILLED'
  END,
  CASE WHEN pps.credential_state='LEGACY_MANUAL' THEN 'RECOVERY_REQUIRED' ELSE 'RESOLVED' END,
  CASE WHEN pps.credential_state='LEGACY_MANUAL'
    THEN 'RECOVER_EXISTING_SUBACCOUNT_CREDENTIAL_ONCE_NO_RECREATE'
    ELSE 'NO_ACTION_SERVICE_MANAGED_READY'
  END,
  json_object(
    'clientId',ppa.client_id,
    'projectId',ppa.project_id,
    'environment',ppa.environment,
    'providerSubAccountLast4',substr(ppa.provider_sub_account_id,-4),
    'provisioningState',ppa.provisioning_state,
    'credentialState',pps.credential_state
  )
FROM payment_provider_accounts ppa
JOIN provider_provisioning_sessions pps ON pps.provider_account_registry_id=ppa.id
WHERE ppa.provider='E2PAY' AND ppa.account_scope='SUB_ACCOUNT'
  AND ppa.status='ACTIVE' AND ppa.provider_sub_account_id IS NOT NULL;

-- Legacy governed-bank closure: pre-P5.7.7 corporate beneficiaries remain blocked
-- until they pass the new maker-checker verification lifecycle.
INSERT OR IGNORE INTO legacy_compatibility_records(
  id,org_id,resource_type,resource_id,classification,compatibility_status,resolution_strategy,safe_detail_json
)
SELECT
  'LCR-CBA-' || cba.id,cba.org_id,'CORPORATE_BENEFICIARY',cba.id,
  'LEGACY_CORPORATE_BENEFICIARY_REVIEW_REQUIRED','RECOVERY_REQUIRED',
  'REVERIFY_THROUGH_P5_7_7_MAKER_CHECKER',
  json_object('clientId',cba.client_id,'bankCode',cba.bank_code,'accountLast4',cba.account_number_last4,'status',cba.status,'isPrimary',cba.is_primary)
FROM client_bank_accounts cba
WHERE cba.status='VERIFIED' AND cba.is_primary=1
  AND (cba.source_change_request_id IS NULL OR cba.verification_version=0);
