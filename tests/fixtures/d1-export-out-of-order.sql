-- Simulates a D1 export whose post-schema objects appear before referenced tables.
CREATE UNIQUE INDEX idx_fixture_sla ON billing_sla_policies(id);
CREATE TRIGGER fixture_sla_audit
AFTER INSERT ON billing_sla_policies
BEGIN
  INSERT INTO audit_logs(id) VALUES(NEW.id);
END;

CREATE TABLE app_users(id TEXT PRIMARY KEY);
CREATE TABLE app_sessions(id TEXT PRIMARY KEY);
CREATE TABLE clients(id TEXT PRIMARY KEY);
CREATE TABLE projects(id TEXT PRIMARY KEY);
CREATE TABLE employees(id TEXT PRIMARY KEY);
CREATE TABLE employee_bank_accounts(id TEXT PRIMARY KEY);
CREATE TABLE payroll_submissions(id TEXT PRIMARY KEY);
CREATE TABLE payment_instructions(id TEXT PRIMARY KEY);
CREATE TABLE payment_gateway_transactions(id TEXT PRIMARY KEY);
CREATE TABLE audit_logs(id TEXT PRIMARY KEY);
CREATE TABLE billing_sla_policies(id TEXT PRIMARY KEY);

INSERT INTO billing_sla_policies(id) VALUES('SLA-1');
