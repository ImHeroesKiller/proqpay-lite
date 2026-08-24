CREATE TABLE IF NOT EXISTS payroll_bank_snapshots (
  submission_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  account_fingerprint TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (submission_id, employee_id),
  FOREIGN KEY (submission_id) REFERENCES payroll_submissions(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_bank_snapshots_submission
  ON payroll_bank_snapshots(submission_id);
