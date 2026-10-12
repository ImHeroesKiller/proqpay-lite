PRAGMA foreign_keys = ON;

ALTER TABLE client_bank_accounts ADD COLUMN source_change_request_id TEXT;
ALTER TABLE client_bank_accounts ADD COLUMN last_change_request_id TEXT;
ALTER TABLE client_bank_accounts ADD COLUMN verification_version INTEGER NOT NULL DEFAULT 0 CHECK (verification_version >= 0);
ALTER TABLE client_bank_accounts ADD COLUMN activated_at TEXT;
ALTER TABLE client_bank_accounts ADD COLUMN suspended_at TEXT;
ALTER TABLE client_bank_accounts ADD COLUMN revoked_at TEXT;

CREATE TABLE IF NOT EXISTS client_bank_account_change_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  purpose TEXT NOT NULL DEFAULT 'PAYROLL_SETTLEMENT' CHECK (purpose IN ('PAYROLL_SETTLEMENT')),
  action TEXT NOT NULL CHECK (action IN ('CREATE_PRIMARY','REPLACE_PRIMARY','SET_PRIMARY','SUSPEND','REVOKE')),
  target_account_id TEXT REFERENCES client_bank_accounts(id),
  previous_primary_account_id TEXT REFERENCES client_bank_accounts(id),
  proposed_bank_code TEXT,
  proposed_bank_name TEXT,
  proposed_account_name TEXT,
  proposed_account_number_ciphertext TEXT,
  proposed_account_number_iv TEXT,
  proposed_account_number_hash TEXT,
  proposed_account_number_last4 TEXT CHECK (proposed_account_number_last4 IS NULL OR length(proposed_account_number_last4)=4),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED')),
  requested_by_user_id TEXT,
  requested_by_email TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_by_user_id TEXT,
  reviewed_by_email TEXT,
  reviewed_at TEXT,
  verification_reference TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_bank_pending_change
  ON client_bank_account_change_requests(org_id,client_id,purpose)
  WHERE status='PENDING_APPROVAL';

CREATE INDEX IF NOT EXISTS idx_client_bank_change_queue
  ON client_bank_account_change_requests(org_id,status,requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_bank_change_client
  ON client_bank_account_change_requests(org_id,client_id,status,updated_at DESC);

CREATE TRIGGER IF NOT EXISTS client_bank_verified_sensitive_fields_immutable
BEFORE UPDATE OF bank_code,bank_name,account_name,account_number_ciphertext,account_number_iv,account_number_hash,account_number_last4,purpose
ON client_bank_accounts
WHEN OLD.status='VERIFIED' OR OLD.verification_version>0
BEGIN
  SELECT RAISE(ABORT,'Verified corporate beneficiary details are immutable');
END;

CREATE TRIGGER IF NOT EXISTS client_bank_governed_status_transition
BEFORE UPDATE OF status,is_primary ON client_bank_accounts
WHEN (OLD.status<>NEW.status OR OLD.is_primary<>NEW.is_primary)
  AND OLD.verification_version>0
  AND NOT EXISTS (
    SELECT 1 FROM client_bank_account_change_requests cr
    WHERE cr.id=NEW.last_change_request_id
      AND cr.status='APPROVED'
      AND cr.org_id=OLD.org_id
      AND cr.client_id=OLD.client_id
      AND cr.purpose=OLD.purpose
      AND (cr.target_account_id=OLD.id OR cr.previous_primary_account_id=OLD.id)
  )
BEGIN
  SELECT RAISE(ABORT,'Corporate beneficiary lifecycle change requires approved change request');
END;

CREATE TRIGGER IF NOT EXISTS client_bank_governed_verified_insert
BEFORE INSERT ON client_bank_accounts
WHEN NEW.status='VERIFIED' AND NEW.verification_version>0
  AND NOT EXISTS (
    SELECT 1 FROM client_bank_account_change_requests cr
    WHERE cr.id=NEW.source_change_request_id
      AND cr.status='APPROVED'
      AND cr.org_id=NEW.org_id
      AND cr.client_id=NEW.client_id
      AND cr.purpose=NEW.purpose
      AND cr.action IN ('CREATE_PRIMARY','REPLACE_PRIMARY')
  )
BEGIN
  SELECT RAISE(ABORT,'Verified corporate beneficiary requires approved source change request');
END;
