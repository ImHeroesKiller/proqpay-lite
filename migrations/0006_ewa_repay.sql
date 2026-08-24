PRAGMA foreign_keys = ON;

-- Allow REPAYING (payday deduction in flight) and link EWA to the pay run.
-- Additive: rebuilds only ewa_requests. Does not alter payroll_run_lines, PI, or billing.

CREATE TABLE ewa_requests_new (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  repayment INTEGER NOT NULL DEFAULT 0 CHECK (repayment >= 0),
  method TEXT NOT NULL DEFAULT 'SALARY_ACCOUNT',
  tenor_months INTEGER NOT NULL DEFAULT 1 CHECK (tenor_months >= 1),
  status TEXT NOT NULL CHECK (status IN (
    'SUBMITTED','APPROVED','REJECTED','DISBURSED','REPAYING','REPAID','CANCELLED'
  )),
  plafond_snapshot INTEGER NOT NULL DEFAULT 0,
  days_worked_snapshot INTEGER NOT NULL DEFAULT 0,
  tenure_months_snapshot INTEGER NOT NULL DEFAULT 0,
  employee_note TEXT,
  decision_note TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  payroll_submission_id TEXT REFERENCES payroll_submissions(id),
  applied_at TEXT
);

INSERT INTO ewa_requests_new (
  id, org_id, client_id, employee_id, period, amount, fee, repayment, method, tenor_months,
  status, plafond_snapshot, days_worked_snapshot, tenure_months_snapshot, employee_note,
  decision_note, decided_by, decided_at, created_at, updated_at, payroll_submission_id, applied_at
)
SELECT
  id, org_id, client_id, employee_id, period, amount, fee, repayment, method, tenor_months,
  status, plafond_snapshot, days_worked_snapshot, tenure_months_snapshot, employee_note,
  decision_note, decided_by, decided_at, created_at, updated_at, NULL, NULL
FROM ewa_requests;

DROP TABLE ewa_requests;
ALTER TABLE ewa_requests_new RENAME TO ewa_requests;

CREATE INDEX idx_ewa_requests_employee ON ewa_requests(employee_id, created_at);
CREATE INDEX idx_ewa_requests_org_status ON ewa_requests(org_id, status, created_at);
CREATE INDEX idx_ewa_requests_pay_run ON ewa_requests(payroll_submission_id, status);

CREATE UNIQUE INDEX idx_ewa_one_open
  ON ewa_requests(employee_id, period)
  WHERE status IN ('SUBMITTED','APPROVED','DISBURSED','REPAYING');
