PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS disbursement_reconciliation_attempts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  disbursement_request_id TEXT NOT NULL REFERENCES disbursement_requests(id),
  disbursement_execution_id TEXT NOT NULL REFERENCES disbursement_executions(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','MATCHED','PARTIAL','FAILED','ERROR')),
  total_items INTEGER NOT NULL DEFAULT 0,
  succeeded_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  unresolved_items INTEGER NOT NULL DEFAULT 0,
  settled_amount INTEGER NOT NULL DEFAULT 0,
  failed_amount INTEGER NOT NULL DEFAULT 0,
  unresolved_amount INTEGER NOT NULL DEFAULT 0,
  provider_found_count INTEGER NOT NULL DEFAULT 0,
  provider_missing_count INTEGER NOT NULL DEFAULT 0,
  correlation_id TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_by_user_id TEXT,
  created_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_disbursement_reconcile_request
  ON disbursement_reconciliation_attempts(disbursement_request_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disbursement_reconcile_status
  ON disbursement_reconciliation_attempts(org_id,status,created_at DESC);

CREATE VIEW IF NOT EXISTS canonical_transaction_register AS
SELECT
  dr.id AS disbursement_request_id,
  dr.org_id,
  dr.client_id,
  dr.project_id,
  dr.purpose,
  dr.destination_mode,
  dr.beneficiary_type,
  dr.source_document_type,
  dr.source_document_id,
  dr.provider,
  dr.provider_environment,
  dr.provider_sub_account_id_snapshot,
  dr.client_reference,
  dr.correlation_id,
  dr.amount,
  dr.currency,
  dr.recipient_count,
  dr.status AS disbursement_status,
  dr.requested_by_email,
  dr.approved_by_email,
  dr.requested_at,
  dr.approved_at,
  dr.execution_started_at,
  dr.settled_at,
  dr.reconciled_at,
  dr.created_at,
  de.id AS execution_id,
  de.provider_channel,
  de.status AS execution_status,
  de.completed_at AS execution_completed_at,
  de.error_code AS execution_error_code,
  de.error_message AS execution_error_message,
  COALESCE((SELECT COUNT(*) FROM disbursement_execution_items dei WHERE dei.disbursement_execution_id=de.id AND dei.status='SUCCEEDED'),0) AS succeeded_items,
  COALESCE((SELECT COUNT(*) FROM disbursement_execution_items dei WHERE dei.disbursement_execution_id=de.id AND dei.status='FAILED'),0) AS failed_items,
  COALESCE((SELECT COUNT(*) FROM disbursement_execution_items dei WHERE dei.disbursement_execution_id=de.id AND dei.status IN ('PENDING','PROCESSING','UNKNOWN')),0) AS unresolved_items,
  COALESCE((SELECT SUM(dei.amount) FROM disbursement_execution_items dei WHERE dei.disbursement_execution_id=de.id AND dei.status='SUCCEEDED'),0) AS settled_amount,
  COALESCE((SELECT SUM(dei.amount) FROM disbursement_execution_items dei WHERE dei.disbursement_execution_id=de.id AND dei.status='FAILED'),0) AS failed_amount,
  (SELECT dra.status FROM disbursement_reconciliation_attempts dra WHERE dra.disbursement_request_id=dr.id ORDER BY dra.created_at DESC,dra.id DESC LIMIT 1) AS reconciliation_status,
  (SELECT dra.created_at FROM disbursement_reconciliation_attempts dra WHERE dra.disbursement_request_id=dr.id ORDER BY dra.created_at DESC,dra.id DESC LIMIT 1) AS last_reconciled_at
FROM disbursement_requests dr
LEFT JOIN disbursement_executions de ON de.disbursement_request_id=dr.id;

-- P5.7.4 initially froze every item column. Keep financial/beneficiary snapshot
-- immutable, but allow operational provider/reconciliation fields to advance.
DROP TRIGGER IF EXISTS disbursement_item_snapshot_immutable_ready;
CREATE TRIGGER IF NOT EXISTS disbursement_item_snapshot_immutable_ready
BEFORE UPDATE OF
  disbursement_request_id,sequence_no,source_item_type,source_item_id,
  beneficiary_type,beneficiary_reference,employee_id,client_bank_account_id,
  bank_code,bank_name,beneficiary_name,account_number_ciphertext,account_number_iv,
  account_number_hash,account_number_last4,beneficiary_hash,amount,currency,client_reference
ON disbursement_request_items
WHEN EXISTS (
  SELECT 1 FROM disbursement_requests dr
  WHERE dr.id=OLD.disbursement_request_id AND dr.status <> 'DRAFT'
)
BEGIN
  SELECT RAISE(ABORT,'Ready disbursement beneficiary snapshot is immutable');
END;
