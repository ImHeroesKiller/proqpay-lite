CREATE TABLE ewa_employee_settings (
 employee_id TEXT PRIMARY KEY REFERENCES employees(id),
 org_id TEXT NOT NULL REFERENCES organizations(id),
 client_id TEXT NOT NULL REFERENCES clients(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 limit_mode TEXT NOT NULL DEFAULT 'PERCENT' CHECK(limit_mode IN ('PERCENT','FIXED')),
 limit_percent REAL NOT NULL DEFAULT 0.3 CHECK(limit_percent>0 AND limit_percent<=1),
 fixed_limit INTEGER NOT NULL DEFAULT 0 CHECK(fixed_limit>=0),
 salary_mode TEXT NOT NULL DEFAULT 'AUTO' CHECK(salary_mode IN ('AUTO','MANUAL')),
 manual_salary INTEGER CHECK(manual_salary>0),
 manual_period TEXT,
 version INTEGER NOT NULL DEFAULT 1,
 updated_by TEXT NOT NULL,
 change_reason TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
ALTER TABLE ewa_requests ADD COLUMN configuration_version INTEGER;
ALTER TABLE ewa_requests ADD COLUMN salary_reference_snapshot INTEGER;
ALTER TABLE ewa_requests ADD COLUMN salary_source_period_snapshot TEXT;
