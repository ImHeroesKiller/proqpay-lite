PRAGMA foreign_keys = ON;

-- Dashboard read-path indexes. These do not change workflow semantics; they make
-- period-scoped summary queries and downstream status lookups predictable as
-- payroll history grows.
CREATE INDEX IF NOT EXISTS idx_dashboard_submission_period
  ON payroll_submissions(org_id, period, payment_period, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_active_pi_submission
  ON payment_instructions(org_id, submission_id, updated_at DESC, created_at DESC)
  WHERE status <> 'REJECTED';

CREATE INDEX IF NOT EXISTS idx_dashboard_reconciliation_instruction_created
  ON reconciliations(payment_instruction_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_invoice_instruction_updated
  ON invoices(org_id, payment_instruction_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_ar_invoice_updated
  ON ar_monitor(org_id, invoice_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_employee_scope
  ON employees(org_id, client_id, project_id, status_aktif);

CREATE INDEX IF NOT EXISTS idx_dashboard_primary_bank
  ON employee_bank_accounts(employee_id, is_primary);
