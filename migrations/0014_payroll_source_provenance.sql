-- Immutable payroll upload provenance and canonical snapshot linkage.
CREATE TABLE IF NOT EXISTS payroll_upload_batches (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  template_version TEXT NOT NULL DEFAULT 'PROQPAY_PAYROLL_V1',
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sheet_name TEXT,
  raw_row_count INTEGER NOT NULL DEFAULT 0,
  accepted_row_count INTEGER NOT NULL DEFAULT 0,
  rejected_row_count INTEGER NOT NULL DEFAULT 0,
  source_total_gross INTEGER NOT NULL DEFAULT 0,
  source_total_deduction INTEGER NOT NULL DEFAULT 0,
  source_total_net INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  validation_summary TEXT,
  UNIQUE(org_id, submission_id, file_sha256)
);
CREATE INDEX IF NOT EXISTS idx_payroll_upload_batches_submission ON payroll_upload_batches(submission_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS payroll_upload_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  row_no INTEGER NOT NULL,
  employee_id TEXT,
  raw_payload TEXT NOT NULL,
  normalized_payload TEXT,
  validation_status TEXT NOT NULL DEFAULT 'ACCEPTED',
  validation_errors TEXT,
  row_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(batch_id, row_no),
  FOREIGN KEY(batch_id) REFERENCES payroll_upload_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_upload_rows_batch_employee ON payroll_upload_rows(batch_id, employee_id);

ALTER TABLE payroll_run_lines ADD COLUMN source_batch_id TEXT;
ALTER TABLE payroll_run_lines ADD COLUMN source_row_no INTEGER;
ALTER TABLE payroll_run_lines ADD COLUMN source_row_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_source_batch ON payroll_run_lines(source_batch_id, source_row_no);
