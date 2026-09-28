PRAGMA foreign_keys = ON;

-- One-time cleanup of E2Pay UAT fixtures created during gateway integration testing.
-- Scope is limited to dedicated E2Pay UAT namespaces and their dependency closure.
-- Production/shared client, employee, payroll and payment records are untouched.
-- D1 does not permit TEMP schema usage in remote migrations, so helper tables are
-- short-lived regular tables that are dropped before and after this migration.

DROP TRIGGER IF EXISTS payment_instruction_lines_immutable_delete;
DROP TRIGGER IF EXISTS payroll_run_lines_locked_delete;

DROP TABLE IF EXISTS _e2pay_uat_submissions;
CREATE TABLE _e2pay_uat_submissions (id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _e2pay_uat_submissions(id)
WITH RECURSIVE target(id) AS (
  SELECT id
  FROM payroll_submissions
  WHERE id LIKE 'SUB-E2PAY-UAT-%'
     OR client_id LIKE 'CLI-E2PAY-UAT-%'
     OR project_id LIKE 'PRJ-E2PAY-UAT-%'
  UNION
  SELECT s.id
  FROM payroll_submissions s
  JOIN target t ON s.parent_submission_id=t.id
)
SELECT id FROM target;

DROP TABLE IF EXISTS _e2pay_uat_pis;
CREATE TABLE _e2pay_uat_pis (id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _e2pay_uat_pis(id)
SELECT id
FROM payment_instructions
WHERE submission_id IN (SELECT id FROM _e2pay_uat_submissions)
   OR client_id LIKE 'CLI-E2PAY-UAT-%';

DROP TABLE IF EXISTS _e2pay_uat_tx;
CREATE TABLE _e2pay_uat_tx (id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _e2pay_uat_tx(id)
SELECT id
FROM payment_gateway_transactions
WHERE payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis)
   OR client_id LIKE 'CLI-E2PAY-UAT-%';

DROP TABLE IF EXISTS _e2pay_uat_invoices;
CREATE TABLE _e2pay_uat_invoices (id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _e2pay_uat_invoices(id)
SELECT id
FROM invoices
WHERE payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis)
   OR client_id LIKE 'CLI-E2PAY-UAT-%'
   OR project_id LIKE 'PRJ-E2PAY-UAT-%';

DROP TABLE IF EXISTS _e2pay_uat_ar;
CREATE TABLE _e2pay_uat_ar (id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _e2pay_uat_ar(id)
SELECT id
FROM ar_monitor
WHERE invoice_id IN (SELECT id FROM _e2pay_uat_invoices)
   OR client_id LIKE 'CLI-E2PAY-UAT-%'
   OR project_id LIKE 'PRJ-E2PAY-UAT-%';

DROP TABLE IF EXISTS _e2pay_uat_employees;
CREATE TABLE _e2pay_uat_employees (id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _e2pay_uat_employees(id)
SELECT id
FROM employees
WHERE id LIKE 'EMP-E2PAY-UAT-%'
   OR client_id LIKE 'CLI-E2PAY-UAT-%'
   OR project_id LIKE 'PRJ-E2PAY-UAT-%';

DROP TABLE IF EXISTS _e2pay_uat_upload_batches;
CREATE TABLE _e2pay_uat_upload_batches (id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _e2pay_uat_upload_batches(id)
SELECT id
FROM payroll_upload_batches
WHERE submission_id IN (SELECT id FROM _e2pay_uat_submissions);

DROP TABLE IF EXISTS _e2pay_uat_service_plans;
CREATE TABLE _e2pay_uat_service_plans (id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _e2pay_uat_service_plans(id)
SELECT id
FROM client_service_plans
WHERE id LIKE 'SP-E2PAY-UAT-%'
   OR client_id LIKE 'CLI-E2PAY-UAT-%'
   OR project_id LIKE 'PRJ-E2PAY-UAT-%';

DROP TABLE IF EXISTS _e2pay_uat_connections;
CREATE TABLE _e2pay_uat_connections (id TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _e2pay_uat_connections(id)
SELECT id FROM integration_connections
WHERE client_id LIKE 'CLI-E2PAY-UAT-%';

DELETE FROM invoice_delivery_events
WHERE invoice_id IN (SELECT id FROM _e2pay_uat_invoices);

DELETE FROM billing_sla_evidence
WHERE invoice_id IN (SELECT id FROM _e2pay_uat_invoices)
   OR payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis)
   OR client_id LIKE 'CLI-E2PAY-UAT-%'
   OR project_id LIKE 'PRJ-E2PAY-UAT-%';

DELETE FROM ar_payment_idempotency
WHERE ar_id IN (SELECT id FROM _e2pay_uat_ar);

DELETE FROM ar_payments
WHERE ar_id IN (SELECT id FROM _e2pay_uat_ar);

DELETE FROM ar_follow_ups
WHERE ar_id IN (SELECT id FROM _e2pay_uat_ar);

DELETE FROM unapplied_cash
WHERE ar_id IN (SELECT id FROM _e2pay_uat_ar)
   OR invoice_id IN (SELECT id FROM _e2pay_uat_invoices)
   OR client_id LIKE 'CLI-E2PAY-UAT-%';

DELETE FROM ar_monitor
WHERE id IN (SELECT id FROM _e2pay_uat_ar);

DELETE FROM invoices
WHERE id IN (SELECT id FROM _e2pay_uat_invoices);

DELETE FROM payment_gateway_events
WHERE payment_gateway_transaction_id IN (SELECT id FROM _e2pay_uat_tx);

DELETE FROM hosted_payment_sessions
WHERE payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis)
   OR payment_gateway_transaction_id IN (SELECT id FROM _e2pay_uat_tx)
   OR client_id LIKE 'CLI-E2PAY-UAT-%';

DELETE FROM payment_gateway_items
WHERE payment_gateway_transaction_id IN (SELECT id FROM _e2pay_uat_tx)
   OR payment_instruction_line_id IN (
     SELECT id FROM payment_instruction_lines
     WHERE payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis)
   );

DELETE FROM payment_gateway_transactions
WHERE id IN (SELECT id FROM _e2pay_uat_tx);

DELETE FROM reconciliation_attempts
WHERE payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis);

DELETE FROM reconciliations
WHERE payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis);

DELETE FROM payment_proofs
WHERE payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis);

DELETE FROM payment_approvals
WHERE payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis);

DELETE FROM audit_logs
WHERE (entity='payment_instruction' AND entity_id IN (SELECT id FROM _e2pay_uat_pis))
   OR (entity='payroll_submission' AND entity_id IN (SELECT id FROM _e2pay_uat_submissions))
   OR entity_id IN (SELECT id FROM _e2pay_uat_employees)
   OR entity_id LIKE 'CLI-E2PAY-UAT-%'
   OR entity_id LIKE 'PRJ-E2PAY-UAT-%'
   OR action LIKE 'E2PAY_UAT_%';

DELETE FROM payment_instruction_lines
WHERE payment_instruction_id IN (SELECT id FROM _e2pay_uat_pis);

DELETE FROM payment_instructions
WHERE id IN (SELECT id FROM _e2pay_uat_pis);

DELETE FROM payroll_bank_snapshots
WHERE submission_id IN (SELECT id FROM _e2pay_uat_submissions)
   OR employee_id IN (SELECT id FROM _e2pay_uat_employees);

DELETE FROM ewa_requests
WHERE payroll_submission_id IN (SELECT id FROM _e2pay_uat_submissions)
   OR employee_id IN (SELECT id FROM _e2pay_uat_employees)
   OR client_id LIKE 'CLI-E2PAY-UAT-%';

DELETE FROM payroll_intake_missing_resolutions
WHERE employee_id IN (SELECT id FROM _e2pay_uat_employees)
   OR batch_id IN (SELECT id FROM _e2pay_uat_upload_batches);

DELETE FROM employee_master_history
WHERE employee_id IN (SELECT id FROM _e2pay_uat_employees)
   OR source_batch_id IN (SELECT id FROM _e2pay_uat_upload_batches);

DELETE FROM payroll_upload_rows
WHERE batch_id IN (SELECT id FROM _e2pay_uat_upload_batches);

DELETE FROM payroll_upload_batches
WHERE id IN (SELECT id FROM _e2pay_uat_upload_batches);

DELETE FROM payroll_exceptions
WHERE submission_id IN (SELECT id FROM _e2pay_uat_submissions)
   OR employee_id IN (SELECT id FROM _e2pay_uat_employees);

DELETE FROM submission_versions
WHERE submission_id IN (SELECT id FROM _e2pay_uat_submissions)
   OR parent_version_id IN (
     SELECT id FROM submission_versions
     WHERE submission_id IN (SELECT id FROM _e2pay_uat_submissions)
   );

DELETE FROM payroll_run_lines
WHERE submission_id IN (SELECT id FROM _e2pay_uat_submissions)
   OR employee_id IN (SELECT id FROM _e2pay_uat_employees);

DELETE FROM payroll_submissions
WHERE id IN (SELECT id FROM _e2pay_uat_submissions);

DELETE FROM portal_login_attempts
WHERE employee_id IN (SELECT id FROM _e2pay_uat_employees)
   OR employee_id_input IN (SELECT id FROM _e2pay_uat_employees);

DELETE FROM user_project_scopes WHERE project_id LIKE 'PRJ-E2PAY-UAT-%';
DELETE FROM user_client_scopes WHERE client_id LIKE 'CLI-E2PAY-UAT-%';

DELETE FROM integration_sync_runs
WHERE connection_id IN (SELECT id FROM _e2pay_uat_connections);
DELETE FROM integration_connections
WHERE id IN (SELECT id FROM _e2pay_uat_connections);

DELETE FROM portal_ads WHERE client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM portal_settings WHERE client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM ewa_policies WHERE client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM billing_rules
WHERE client_id LIKE 'CLI-E2PAY-UAT-%'
   OR project_id LIKE 'PRJ-E2PAY-UAT-%'
   OR service_plan_id IN (SELECT id FROM _e2pay_uat_service_plans);
DELETE FROM billing_sla_policies
WHERE client_id LIKE 'CLI-E2PAY-UAT-%'
   OR project_id LIKE 'PRJ-E2PAY-UAT-%';

DELETE FROM employees
WHERE id IN (SELECT id FROM _e2pay_uat_employees);

DELETE FROM client_service_plans
WHERE id IN (SELECT id FROM _e2pay_uat_service_plans);

DELETE FROM projects
WHERE id LIKE 'PRJ-E2PAY-UAT-%';

DELETE FROM clients
WHERE id LIKE 'CLI-E2PAY-UAT-%';

DROP TABLE _e2pay_uat_connections;
DROP TABLE _e2pay_uat_service_plans;
DROP TABLE _e2pay_uat_upload_batches;
DROP TABLE _e2pay_uat_employees;
DROP TABLE _e2pay_uat_ar;
DROP TABLE _e2pay_uat_invoices;
DROP TABLE _e2pay_uat_tx;
DROP TABLE _e2pay_uat_pis;
DROP TABLE _e2pay_uat_submissions;

CREATE TRIGGER payment_instruction_lines_immutable_delete
BEFORE DELETE ON payment_instruction_lines
BEGIN
  SELECT RAISE(ABORT, 'Payment instruction snapshot is immutable');
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
