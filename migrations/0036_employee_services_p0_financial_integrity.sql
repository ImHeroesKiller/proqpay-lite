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

-- Preserve pre-migration approved/disbursed rows without granting new authority.
UPDATE ewa_requests
SET approved_by = decided_by,
    approved_at = decided_at
WHERE status IN ('APPROVED','DISBURSED','REPAYING','REPAID')
  AND approved_by IS NULL
  AND decided_by IS NOT NULL;

UPDATE ewa_requests
SET destination_bank_name = (
      SELECT b.bank_name FROM employee_bank_accounts b
      WHERE b.employee_id=ewa_requests.employee_id AND b.is_primary=1
      ORDER BY b.updated_at DESC, b.id DESC LIMIT 1
    ),
    destination_account_last4 = (
      SELECT substr(replace(b.account_no,' ',''),-4) FROM employee_bank_accounts b
      WHERE b.employee_id=ewa_requests.employee_id AND b.is_primary=1
      ORDER BY b.updated_at DESC, b.id DESC LIMIT 1
    )
WHERE destination_account_last4 IS NULL;

CREATE INDEX IF NOT EXISTS idx_ewa_requests_approval_actor
  ON ewa_requests(org_id, approved_by, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ewa_disbursement_reference
  ON ewa_requests(org_id, disbursement_source, disbursement_reference)
  WHERE disbursement_reference IS NOT NULL AND disbursement_reference <> '';
