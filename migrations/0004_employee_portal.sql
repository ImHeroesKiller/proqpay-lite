PRAGMA foreign_keys = ON;

-- Employee Self-Service credentials. Separate from ops app_users.
-- Additive: does not alter payroll, PI, billing, or employee master tables.

CREATE TABLE employee_credentials (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  default_password_scheme TEXT NOT NULL DEFAULT 'PROJECT_JOIN_DATE',
  default_password_issued_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE employee_portal_sessions (
  token_hash TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_employee_portal_sessions_employee
  ON employee_portal_sessions(employee_id);
CREATE INDEX idx_employee_portal_sessions_expiry
  ON employee_portal_sessions(expires_at);

CREATE TABLE portal_login_attempts (
  id TEXT PRIMARY KEY,
  employee_id_input TEXT,
  employee_id TEXT,
  ip TEXT,
  success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_portal_login_attempts_ip_created
  ON portal_login_attempts(ip, created_at);
CREATE INDEX idx_portal_login_attempts_input_created
  ON portal_login_attempts(employee_id_input, created_at);
CREATE INDEX idx_portal_login_attempts_created
  ON portal_login_attempts(created_at);
