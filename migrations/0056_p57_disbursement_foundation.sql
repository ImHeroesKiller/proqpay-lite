PRAGMA foreign_keys = ON;

-- P5.7.0 Architecture Contract & Schema Foundation
-- Additive only. Existing P5.6 E2Pay execution remains authoritative until later
-- P5.7 cutover bundles explicitly switch runtime behavior.

CREATE TABLE IF NOT EXISTS provider_provisioning_sessions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  provider TEXT NOT NULL DEFAULT 'E2PAY',
  environment TEXT NOT NULL CHECK (environment IN ('UAT','PRODUCTION')),
  provider_account_registry_id TEXT REFERENCES payment_provider_accounts(id),
  state TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (state IN (
      'NOT_STARTED','REGISTERING','OTP_REQUIRED','ACTIVATING','VALIDATING',
      'READY','RETRYABLE_ERROR','MANUAL_REVIEW','SUSPENDED'
    )),
  credential_mode TEXT NOT NULL DEFAULT 'SERVICE_MANAGED'
    CHECK (credential_mode='SERVICE_MANAGED'),
  provider_registration_id TEXT,
  provider_username TEXT,
  token_prefix TEXT,
  account_group_id TEXT,
  provider_account_id TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  otp_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (otp_attempt_count >= 0),
  last_attempt_at TEXT,
  ready_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(org_id,client_id,project_id,provider,environment)
);

CREATE INDEX IF NOT EXISTS idx_provider_provisioning_state
  ON provider_provisioning_sessions(org_id,provider,environment,state,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_provisioning_client
  ON provider_provisioning_sessions(org_id,client_id,project_id,provider,updated_at DESC);

CREATE TABLE IF NOT EXISTS client_bank_accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  bank_code TEXT NOT NULL,
  bank_name TEXT,
  account_name TEXT NOT NULL,
  account_number_ciphertext TEXT NOT NULL,
  account_number_iv TEXT NOT NULL,
  account_number_hash TEXT NOT NULL,
  account_number_last4 TEXT NOT NULL CHECK (length(account_number_last4)=4),
  purpose TEXT NOT NULL DEFAULT 'PAYROLL_SETTLEMENT'
    CHECK (purpose IN ('PAYROLL_SETTLEMENT')),
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (status IN ('PENDING_VERIFICATION','VERIFIED','SUSPENDED','REVOKED')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  verified_by_user_id TEXT,
  verified_by_email TEXT,
  verified_at TEXT,
  created_by_user_id TEXT,
  created_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by_user_id TEXT,
  updated_by_email TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (status='VERIFIED' AND verified_by_email IS NOT NULL AND verified_at IS NOT NULL)
    OR status<>'VERIFIED'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_bank_account_hash
  ON client_bank_accounts(org_id,client_id,account_number_hash)
  WHERE status<>'REVOKED';

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_primary_verified_bank
  ON client_bank_accounts(org_id,client_id,purpose)
  WHERE is_primary=1 AND status='VERIFIED';

CREATE INDEX IF NOT EXISTS idx_client_bank_account_status
  ON client_bank_accounts(org_id,client_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_channel_mappings (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('UAT','PRODUCTION')),
  purpose TEXT NOT NULL CHECK (purpose IN ('PAYROLL','EWA')),
  destination_mode TEXT NOT NULL CHECK (destination_mode IN ('DIRECT_EMPLOYEE','CLIENT_ACCOUNT')),
  beneficiary_type TEXT NOT NULL CHECK (beneficiary_type IN ('EMPLOYEE','CORPORATE')),
  provider_channel TEXT,
  mapping_status TEXT NOT NULL DEFAULT 'PENDING_PROVIDER_CONFIRMATION'
    CHECK (mapping_status IN ('PENDING_PROVIDER_CONFIRMATION','ACTIVE','INACTIVE')),
  config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
  effective_from TEXT,
  effective_until TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (purpose='PAYROLL' AND destination_mode='DIRECT_EMPLOYEE' AND beneficiary_type='EMPLOYEE')
    OR (purpose='PAYROLL' AND destination_mode='CLIENT_ACCOUNT' AND beneficiary_type='CORPORATE')
    OR (purpose='EWA' AND destination_mode='DIRECT_EMPLOYEE' AND beneficiary_type='EMPLOYEE')
  ),
  CHECK (
    mapping_status<>'ACTIVE'
    OR (provider_channel IS NOT NULL AND length(trim(provider_channel))>0)
  ),
  UNIQUE(provider,environment,purpose,destination_mode,beneficiary_type)
);

CREATE INDEX IF NOT EXISTS idx_provider_channel_active
  ON provider_channel_mappings(provider,environment,mapping_status,purpose,destination_mode);

CREATE TABLE IF NOT EXISTS disbursement_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  provider TEXT NOT NULL DEFAULT 'E2PAY',
  provider_account_registry_id TEXT NOT NULL REFERENCES payment_provider_accounts(id),
  provider_sub_account_id_snapshot TEXT NOT NULL,
  provider_environment TEXT NOT NULL CHECK (provider_environment IN ('UAT','PRODUCTION')),
  purpose TEXT NOT NULL CHECK (purpose IN ('PAYROLL','EWA')),
  destination_mode TEXT NOT NULL CHECK (destination_mode IN ('DIRECT_EMPLOYEE','CLIENT_ACCOUNT')),
  beneficiary_type TEXT NOT NULL CHECK (beneficiary_type IN ('EMPLOYEE','CORPORATE')),
  source_document_type TEXT NOT NULL CHECK (source_document_type IN ('PAYMENT_INSTRUCTION','EWA_REQUEST')),
  source_document_id TEXT NOT NULL,
  provider_channel_mapping_id TEXT REFERENCES provider_channel_mappings(id),
  provider_channel_snapshot TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  recipient_count INTEGER NOT NULL CHECK (recipient_count > 0),
  client_reference TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  routing_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT','READY','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED',
      'EXECUTING','PROCESSING','PARTIALLY_SETTLED','SETTLED','FAILED',
      'RECONCILIATION_REQUIRED','RECONCILED'
    )),
  requested_by_user_id TEXT,
  requested_by_email TEXT,
  requested_at TEXT,
  approved_by_user_id TEXT,
  approved_by_email TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  execution_started_at TEXT,
  settled_at TEXT,
  reconciled_at TEXT,
  created_by_user_id TEXT,
  created_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by_user_id TEXT,
  updated_by_email TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (purpose='PAYROLL' AND source_document_type='PAYMENT_INSTRUCTION')
    OR (purpose='EWA' AND source_document_type='EWA_REQUEST')
  ),
  CHECK (
    (destination_mode='DIRECT_EMPLOYEE' AND beneficiary_type='EMPLOYEE')
    OR (destination_mode='CLIENT_ACCOUNT' AND beneficiary_type='CORPORATE')
  ),
  CHECK (purpose<>'EWA' OR destination_mode='DIRECT_EMPLOYEE'),
  CHECK (
    status NOT IN ('APPROVED','EXECUTING','PROCESSING','PARTIALLY_SETTLED','SETTLED','RECONCILIATION_REQUIRED','RECONCILED')
    OR (approved_by_email IS NOT NULL AND approved_at IS NOT NULL)
  ),
  UNIQUE(provider,provider_environment,client_reference),
  UNIQUE(idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_disbursement_source_active
  ON disbursement_requests(org_id,source_document_type,source_document_id)
  WHERE status NOT IN ('REJECTED','CANCELLED');

CREATE INDEX IF NOT EXISTS idx_disbursement_queue
  ON disbursement_requests(org_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_disbursement_client
  ON disbursement_requests(org_id,client_id,project_id,purpose,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_disbursement_provider_account
  ON disbursement_requests(provider_account_registry_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_disbursement_correlation
  ON disbursement_requests(correlation_id);

CREATE TABLE IF NOT EXISTS disbursement_request_items (
  id TEXT PRIMARY KEY,
  disbursement_request_id TEXT NOT NULL REFERENCES disbursement_requests(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  source_item_type TEXT NOT NULL CHECK (source_item_type IN ('PAYMENT_INSTRUCTION_LINE','EWA_REQUEST','CORPORATE_SETTLEMENT')),
  source_item_id TEXT NOT NULL,
  beneficiary_type TEXT NOT NULL CHECK (beneficiary_type IN ('EMPLOYEE','CORPORATE')),
  beneficiary_reference TEXT NOT NULL,
  employee_id TEXT REFERENCES employees(id),
  client_bank_account_id TEXT REFERENCES client_bank_accounts(id),
  bank_code TEXT NOT NULL,
  bank_name TEXT,
  beneficiary_name TEXT NOT NULL,
  account_number_ciphertext TEXT NOT NULL,
  account_number_iv TEXT NOT NULL,
  account_number_hash TEXT NOT NULL,
  account_number_last4 TEXT NOT NULL CHECK (length(account_number_last4)=4),
  beneficiary_hash TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  client_reference TEXT NOT NULL,
  provider_transaction_id TEXT,
  provider_status TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','INQUIRY_READY','PROCESSING','SETTLED','FAILED','UNKNOWN','RECONCILED')),
  error_code TEXT,
  error_message TEXT,
  settled_at TEXT,
  reconciled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (beneficiary_type='EMPLOYEE' AND employee_id IS NOT NULL AND client_bank_account_id IS NULL)
    OR
    (beneficiary_type='CORPORATE' AND employee_id IS NULL AND client_bank_account_id IS NOT NULL)
  ),
  UNIQUE(disbursement_request_id,sequence_no),
  UNIQUE(disbursement_request_id,source_item_type,source_item_id),
  UNIQUE(client_reference)
);

CREATE INDEX IF NOT EXISTS idx_disbursement_items_request_status
  ON disbursement_request_items(disbursement_request_id,status,sequence_no);

CREATE INDEX IF NOT EXISTS idx_disbursement_items_provider_transaction
  ON disbursement_request_items(provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

-- Once approved, provider/business routing is immutable. Corrections require
-- cancellation before approval or a new canonical request after a rejected/cancelled request.
CREATE TRIGGER IF NOT EXISTS disbursement_request_routing_immutable
BEFORE UPDATE OF
  org_id,client_id,project_id,provider,provider_account_registry_id,
  provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,
  beneficiary_type,source_document_type,source_document_id,provider_channel_mapping_id,
  provider_channel_snapshot,amount,currency,recipient_count,client_reference,
  idempotency_key,routing_hash
ON disbursement_requests
WHEN OLD.status IN (
  'APPROVED','EXECUTING','PROCESSING','PARTIALLY_SETTLED','SETTLED',
  'FAILED','RECONCILIATION_REQUIRED','RECONCILED'
)
AND (
  COALESCE(OLD.org_id,'')<>COALESCE(NEW.org_id,'')
  OR COALESCE(OLD.client_id,'')<>COALESCE(NEW.client_id,'')
  OR COALESCE(OLD.project_id,'')<>COALESCE(NEW.project_id,'')
  OR COALESCE(OLD.provider,'')<>COALESCE(NEW.provider,'')
  OR COALESCE(OLD.provider_account_registry_id,'')<>COALESCE(NEW.provider_account_registry_id,'')
  OR COALESCE(OLD.provider_sub_account_id_snapshot,'')<>COALESCE(NEW.provider_sub_account_id_snapshot,'')
  OR COALESCE(OLD.provider_environment,'')<>COALESCE(NEW.provider_environment,'')
  OR COALESCE(OLD.purpose,'')<>COALESCE(NEW.purpose,'')
  OR COALESCE(OLD.destination_mode,'')<>COALESCE(NEW.destination_mode,'')
  OR COALESCE(OLD.beneficiary_type,'')<>COALESCE(NEW.beneficiary_type,'')
  OR COALESCE(OLD.source_document_type,'')<>COALESCE(NEW.source_document_type,'')
  OR COALESCE(OLD.source_document_id,'')<>COALESCE(NEW.source_document_id,'')
  OR COALESCE(OLD.provider_channel_mapping_id,'')<>COALESCE(NEW.provider_channel_mapping_id,'')
  OR COALESCE(OLD.provider_channel_snapshot,'')<>COALESCE(NEW.provider_channel_snapshot,'')
  OR OLD.amount<>NEW.amount
  OR COALESCE(OLD.currency,'')<>COALESCE(NEW.currency,'')
  OR OLD.recipient_count<>NEW.recipient_count
  OR COALESCE(OLD.client_reference,'')<>COALESCE(NEW.client_reference,'')
  OR COALESCE(OLD.idempotency_key,'')<>COALESCE(NEW.idempotency_key,'')
  OR COALESCE(OLD.routing_hash,'')<>COALESCE(NEW.routing_hash,'')
)
BEGIN
  SELECT RAISE(ABORT,'Approved disbursement routing is immutable');
END;

CREATE TRIGGER IF NOT EXISTS disbursement_item_routing_immutable
BEFORE UPDATE OF
  source_item_type,source_item_id,beneficiary_type,beneficiary_reference,
  employee_id,client_bank_account_id,bank_code,bank_name,beneficiary_name,
  account_number_ciphertext,account_number_iv,account_number_hash,
  account_number_last4,beneficiary_hash,amount,currency,client_reference
ON disbursement_request_items
WHEN EXISTS (
  SELECT 1 FROM disbursement_requests dr
  WHERE dr.id=OLD.disbursement_request_id
    AND dr.status IN (
      'APPROVED','EXECUTING','PROCESSING','PARTIALLY_SETTLED','SETTLED',
      'FAILED','RECONCILIATION_REQUIRED','RECONCILED'
    )
)
BEGIN
  SELECT RAISE(ABORT,'Approved disbursement beneficiary snapshot is immutable');
END;

-- Optional bridge for later P5.7 execution cutover. Existing gateway behavior does
-- not read or write this column yet.
ALTER TABLE payment_gateway_transactions ADD COLUMN disbursement_request_id TEXT REFERENCES disbursement_requests(id);

CREATE INDEX IF NOT EXISTS idx_gateway_disbursement_request
  ON payment_gateway_transactions(disbursement_request_id,created_at DESC);
