PRAGMA foreign_keys = ON;

-- Employee Services P0 financial integrity.
-- Adds immutable approval/disbursement evidence and actor separation fields.

ALTER TABLE ewa_requests ADD COLUMN approved_by TEXT;
ALTER TABLE ewa_requests ADD COLUMN approved_at TEXT;
ALTER TABLE ewa_requests ADD COLUMN disbursed_by TEXT;
ALTER TABLE ewa_requests ADD COLUMN disbursed_at TEXT;
ALTER TABLE ewa_requests ADD COLUMN disbursement_source TEXT;
ALTER TABLE ewa_requests ADD COLUMN disbursement_reference TEXT;
ALTER TABLE ewa_requests ADD COLUMN disbursement_transaction_date TEXT;
ALTER TABLE ewa_requests ADD COLUMN destination_bank_name TEXT;
ALTER TABLE ewa_requests ADD COLUMN destination_account_last4 TEXT;

CREATE INDEX IF NOT EXISTS idx_ewa_requests_approval_actor
  ON ewa_requests(org_id, approved_by, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ewa_disbursement_reference
  ON ewa_requests(org_id, disbursement_source, disbursement_reference)
  WHERE disbursement_reference IS NOT NULL AND disbursement_reference <> '';
