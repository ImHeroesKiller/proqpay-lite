ALTER TABLE payment_proofs ADD COLUMN file_sha256 TEXT;
ALTER TABLE payment_proofs ADD COLUMN file_size INTEGER;
ALTER TABLE payment_proofs ADD COLUMN mime_type TEXT;
ALTER TABLE payment_proofs ADD COLUMN uploaded_by TEXT;

CREATE INDEX idx_payment_proofs_sha256
  ON payment_proofs(payment_instruction_id, file_sha256)
  WHERE file_sha256 IS NOT NULL;

CREATE TABLE reconciliation_attempts (
  id TEXT PRIMARY KEY,
  payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
  expected_total INTEGER NOT NULL,
  instruction_total INTEGER NOT NULL,
  settlement_total INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  settlement_source TEXT NOT NULL,
  status TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reconciliation_attempts_instruction_created
  ON reconciliation_attempts(payment_instruction_id, created_at DESC);
