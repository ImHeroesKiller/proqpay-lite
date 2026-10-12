PRAGMA foreign_keys = ON;

-- P5.7.6 Secure Execution & Funding Integration
CREATE TABLE IF NOT EXISTS e2pay_disbursement_request_limit_usage (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  limit_request_id TEXT NOT NULL REFERENCES e2pay_disbursement_limit_requests(id),
  provider_account_registry_id TEXT NOT NULL REFERENCES payment_provider_accounts(id),
  disbursement_request_id TEXT NOT NULL REFERENCES disbursement_requests(id),
  reserved_amount INTEGER NOT NULL CHECK (reserved_amount > 0),
  consumed_amount INTEGER NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0),
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','CONSUMED','RELEASED')),
  reserved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  consumed_at TEXT,
  released_at TEXT,
  release_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(disbursement_request_id)
);

CREATE INDEX IF NOT EXISTS idx_e2pay_dr_limit_usage_limit
  ON e2pay_disbursement_request_limit_usage(limit_request_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_e2pay_dr_limit_usage_dr
  ON e2pay_disbursement_request_limit_usage(disbursement_request_id,status);

CREATE TABLE IF NOT EXISTS disbursement_executions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  disbursement_request_id TEXT NOT NULL REFERENCES disbursement_requests(id),
  provider TEXT NOT NULL,
  provider_account_registry_id TEXT NOT NULL REFERENCES payment_provider_accounts(id),
  provider_channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','PROCESSING','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  execution_lock_token TEXT,
  execution_lock_expires_at TEXT,
  created_by TEXT NOT NULL,
  actor_user_id TEXT,
  actor_ip_hash TEXT,
  actor_device_hash TEXT,
  mfa_verified_at TEXT,
  risk_decision_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT,
  UNIQUE(disbursement_request_id)
);

CREATE INDEX IF NOT EXISTS idx_disbursement_execution_status
  ON disbursement_executions(org_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS disbursement_execution_items (
  id TEXT PRIMARY KEY,
  disbursement_execution_id TEXT NOT NULL REFERENCES disbursement_executions(id) ON DELETE CASCADE,
  disbursement_request_item_id TEXT NOT NULL REFERENCES disbursement_request_items(id),
  provider TEXT NOT NULL,
  client_ref TEXT NOT NULL,
  bank_id TEXT,
  beneficiary_name TEXT NOT NULL,
  provider_beneficiary_name TEXT,
  account_last4 TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  fee_amount INTEGER NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  inquiry_id TEXT,
  provider_transaction_id TEXT,
  journal_id TEXT,
  response_code TEXT,
  response_message TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','INQUIRY_READY','PENDING','PROCESSING','SUCCEEDED','FAILED','UNKNOWN')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_checked_at TEXT,
  last_attempt_at TEXT,
  failure_stage TEXT,
  error_code TEXT,
  error_message TEXT,
  request_diagnostics_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(disbursement_execution_id,disbursement_request_item_id),
  UNIQUE(provider,client_ref)
);

CREATE INDEX IF NOT EXISTS idx_disbursement_execution_item_status
  ON disbursement_execution_items(disbursement_execution_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_disbursement_execution_provider_ref
  ON disbursement_execution_items(provider,client_ref,provider_transaction_id,journal_id);
