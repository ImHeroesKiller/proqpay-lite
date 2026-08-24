PRAGMA foreign_keys = ON;

-- Earned Wage Access. Additive: does not alter payroll, PI, billing, or employee master.

CREATE TABLE ewa_policies (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  fee_rate REAL NOT NULL DEFAULT 0.03,
  min_fee INTEGER NOT NULL DEFAULT 50000 CHECK (min_fee >= 0),
  min_fee_amount INTEGER NOT NULL DEFAULT 1750000 CHECK (min_fee_amount >= 0),
  max_percent REAL NOT NULL DEFAULT 0.30,
  max_tenor_months INTEGER NOT NULL DEFAULT 1 CHECK (max_tenor_months >= 1),
  min_days_worked INTEGER NOT NULL DEFAULT 10 CHECK (min_days_worked >= 0),
  min_tenure_months INTEGER NOT NULL DEFAULT 1 CHECK (min_tenure_months >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_ewa_policies_scope
  ON ewa_policies(org_id, COALESCE(client_id, ''));

CREATE TABLE ewa_requests (
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
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED','APPROVED','REJECTED','DISBURSED','REPAID','CANCELLED')),
  plafond_snapshot INTEGER NOT NULL DEFAULT 0,
  days_worked_snapshot INTEGER NOT NULL DEFAULT 0,
  tenure_months_snapshot INTEGER NOT NULL DEFAULT 0,
  employee_note TEXT,
  decision_note TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ewa_requests_employee ON ewa_requests(employee_id, created_at);
CREATE INDEX idx_ewa_requests_org_status ON ewa_requests(org_id, status, created_at);

CREATE UNIQUE INDEX idx_ewa_one_open
  ON ewa_requests(employee_id, period)
  WHERE status IN ('SUBMITTED','APPROVED','DISBURSED');
