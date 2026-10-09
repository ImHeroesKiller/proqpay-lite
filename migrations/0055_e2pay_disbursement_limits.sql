PRAGMA foreign_keys = ON;

-- P5.6 Multi-Tenant Funding & Disbursement Limit Control
--
-- Provider routing remains immutable, while balance evidence is operational data
-- that may be refreshed at Controller approval time.
DROP TRIGGER IF EXISTS payment_instruction_provider_snapshot_immutable;

CREATE TRIGGER IF NOT EXISTS payment_instruction_provider_routing_immutable
BEFORE UPDATE OF provider_account_registry_id,provider,provider_environment,provider_sub_account_id,provider_account_snapshot
ON payment_instructions
WHEN
  COALESCE(OLD.provider_account_registry_id,'')<>COALESCE(NEW.provider_account_registry_id,'')
  OR COALESCE(OLD.provider,'')<>COALESCE(NEW.provider,'')
  OR COALESCE(OLD.provider_environment,'')<>COALESCE(NEW.provider_environment,'')
  OR COALESCE(OLD.provider_sub_account_id,'')<>COALESCE(NEW.provider_sub_account_id,'')
  OR COALESCE(OLD.provider_account_snapshot,'')<>COALESCE(NEW.provider_account_snapshot,'')
BEGIN
  SELECT RAISE(ABORT,'Payment instruction provider routing snapshot is immutable');
END;

CREATE TABLE IF NOT EXISTS e2pay_disbursement_limit_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  provider_account_registry_id TEXT NOT NULL REFERENCES payment_provider_accounts(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  environment TEXT NOT NULL CHECK (environment IN ('UAT','PRODUCTION')),
  requested_amount REAL NOT NULL CHECK (requested_amount > 0),
  approved_amount REAL,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (status IN ('PENDING_APPROVAL','ACTIVE','REJECTED','REVOKED','EXHAUSTED','EXPIRED')),
  reason TEXT,
  requested_by_user_id TEXT,
  requested_by_email TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_by_user_id TEXT,
  approved_by_email TEXT,
  approved_at TEXT,
  rejected_reason TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_e2pay_limit_pending_per_account
  ON e2pay_disbursement_limit_requests(org_id,provider_account_registry_id)
  WHERE status='PENDING_APPROVAL';

CREATE UNIQUE INDEX IF NOT EXISTS uq_e2pay_limit_active_per_account
  ON e2pay_disbursement_limit_requests(org_id,provider_account_registry_id)
  WHERE status='ACTIVE';

CREATE INDEX IF NOT EXISTS idx_e2pay_limit_queue
  ON e2pay_disbursement_limit_requests(org_id,status,requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_e2pay_limit_client
  ON e2pay_disbursement_limit_requests(org_id,client_id,project_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS e2pay_disbursement_limit_usage (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  limit_request_id TEXT NOT NULL REFERENCES e2pay_disbursement_limit_requests(id),
  provider_account_registry_id TEXT NOT NULL REFERENCES payment_provider_accounts(id),
  payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
  reserved_amount REAL NOT NULL CHECK (reserved_amount > 0),
  consumed_amount REAL NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0),
  status TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED','CONSUMED','RELEASED')),
  reserved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  consumed_at TEXT,
  released_at TEXT,
  release_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(payment_instruction_id)
);

CREATE INDEX IF NOT EXISTS idx_e2pay_limit_usage_limit
  ON e2pay_disbursement_limit_usage(limit_request_id,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_e2pay_limit_usage_pi
  ON e2pay_disbursement_limit_usage(payment_instruction_id,status);
