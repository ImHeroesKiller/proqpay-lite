PRAGMA foreign_keys = ON;

ALTER TABLE payroll_submissions ADD COLUMN run_type TEXT NOT NULL DEFAULT 'REGULAR'
  CHECK (run_type IN ('REGULAR','OFF_CYCLE','ADJUSTMENT'));
ALTER TABLE payroll_submissions ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'UPLOAD_FINAL'
  CHECK (source_mode IN ('MASTER_CURRENT','COPY_PREVIOUS','UPLOAD_FINAL','HRIS'));
ALTER TABLE payroll_submissions ADD COLUMN parent_submission_id TEXT REFERENCES payroll_submissions(id);
ALTER TABLE payroll_submissions ADD COLUMN payment_date TEXT;
ALTER TABLE payroll_submissions ADD COLUMN input_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (input_status IN ('PENDING','READY'));
ALTER TABLE payroll_submissions ADD COLUMN period_status TEXT NOT NULL DEFAULT 'OPEN'
  CHECK (period_status IN ('OPEN','CLOSED'));
ALTER TABLE payroll_submissions ADD COLUMN closed_at TEXT;
ALTER TABLE payroll_submissions ADD COLUMN closed_by TEXT;
ALTER TABLE payroll_submissions ADD COLUMN reopen_reason TEXT;

CREATE UNIQUE INDEX idx_one_regular_pay_run_scope
  ON payroll_submissions(org_id,client_id,COALESCE(project_id,''),period)
  WHERE run_type='REGULAR' AND state<>'CANCELLED';

CREATE TABLE payroll_run_lines (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES payroll_submissions(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  employee_code TEXT,
  employee_name TEXT NOT NULL,
  employment_status TEXT,
  bank_name TEXT,
  account_last4 TEXT,
  gross_amount INTEGER NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  deduction_amount INTEGER NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  net_amount INTEGER NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  components TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(components)),
  source TEXT NOT NULL,
  included INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0,1)),
  snapshot_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (submission_id, employee_id)
);

CREATE INDEX idx_payroll_run_lines_submission
  ON payroll_run_lines(submission_id,included,employee_name);

CREATE TRIGGER payroll_run_lines_locked_update
BEFORE UPDATE ON payroll_run_lines
WHEN EXISTS (
  SELECT 1 FROM payroll_submissions s WHERE s.id=OLD.submission_id
    AND (s.period_status='CLOSED' OR s.state IN (
      'PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT',
      'DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','COMPLETED'
    ))
)
BEGIN
  SELECT RAISE(ABORT,'payroll run snapshot is locked');
END;

CREATE TRIGGER payroll_run_lines_locked_delete
BEFORE DELETE ON payroll_run_lines
WHEN EXISTS (
  SELECT 1 FROM payroll_submissions s WHERE s.id=OLD.submission_id
    AND (s.period_status='CLOSED' OR s.state<>'DRAFT')
)
BEGIN
  SELECT RAISE(ABORT,'payroll run snapshot is locked');
END;
