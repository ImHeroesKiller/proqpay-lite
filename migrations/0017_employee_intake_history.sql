-- Preserve master-data history while allowing the latest confirmed payroll intake to refresh current employee data.
CREATE TABLE IF NOT EXISTS employee_master_history (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  source_batch_id TEXT NOT NULL,
  payroll_period TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATED','UPDATED','MISSING_RESOLUTION')),
  before_json TEXT,
  after_json TEXT,
  changed_fields TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(changed_fields)),
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(employee_id, source_batch_id, action),
  FOREIGN KEY(employee_id) REFERENCES employees(id),
  FOREIGN KEY(source_batch_id) REFERENCES payroll_upload_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_employee_master_history_employee
  ON employee_master_history(employee_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_master_history_period
  ON employee_master_history(org_id, payroll_period, changed_at DESC);

CREATE TABLE IF NOT EXISTS payroll_intake_missing_resolutions (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('NO_PAY_THIS_PERIOD','RESIGNED','TRANSFERRED','OTHER')),
  note TEXT,
  resolved_by TEXT NOT NULL,
  resolved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(batch_id, employee_id),
  FOREIGN KEY(batch_id) REFERENCES payroll_upload_batches(id),
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_intake_missing_batch
  ON payroll_intake_missing_resolutions(batch_id, resolved_at DESC);
