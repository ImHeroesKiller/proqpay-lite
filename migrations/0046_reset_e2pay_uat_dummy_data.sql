PRAGMA foreign_keys = ON;

-- One-time cleanup of E2Pay UAT fixtures created during gateway integration testing.
-- Scope is deliberately limited to the dedicated SUB-E2PAY-UAT-* namespace and
-- related dedicated master-data IDs. Production payroll/client data is untouched.

DROP TRIGGER IF EXISTS payment_instruction_lines_immutable_delete;
DROP TRIGGER IF EXISTS payroll_run_lines_locked_delete;

DELETE FROM invoice_delivery_events
WHERE invoice_id IN (
  SELECT i.id FROM invoices i
  JOIN payment_instructions pi ON pi.id=i.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM billing_sla_evidence
WHERE payment_instruction_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
)
OR invoice_id IN (
  SELECT i.id FROM invoices i
  JOIN payment_instructions pi ON pi.id=i.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM ar_payment_idempotency
WHERE ar_id IN (
  SELECT ar.id FROM ar_monitor ar
  JOIN invoices i ON i.id=ar.invoice_id
  JOIN payment_instructions pi ON pi.id=i.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM ar_payments
WHERE ar_id IN (
  SELECT ar.id FROM ar_monitor ar
  JOIN invoices i ON i.id=ar.invoice_id
  JOIN payment_instructions pi ON pi.id=i.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM ar_follow_ups
WHERE ar_id IN (
  SELECT ar.id FROM ar_monitor ar
  JOIN invoices i ON i.id=ar.invoice_id
  JOIN payment_instructions pi ON pi.id=i.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM unapplied_cash
WHERE invoice_id IN (
  SELECT i.id FROM invoices i
  JOIN payment_instructions pi ON pi.id=i.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
)
OR ar_id IN (
  SELECT ar.id FROM ar_monitor ar
  JOIN invoices i ON i.id=ar.invoice_id
  JOIN payment_instructions pi ON pi.id=i.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM ar_monitor
WHERE invoice_id IN (
  SELECT i.id FROM invoices i
  JOIN payment_instructions pi ON pi.id=i.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM invoices
WHERE payment_instruction_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM payment_gateway_events
WHERE payment_gateway_transaction_id IN (
  SELECT gt.id FROM payment_gateway_transactions gt
  JOIN payment_instructions pi ON pi.id=gt.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM hosted_payment_sessions
WHERE payment_instruction_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM payment_gateway_items
WHERE payment_gateway_transaction_id IN (
  SELECT gt.id FROM payment_gateway_transactions gt
  JOIN payment_instructions pi ON pi.id=gt.payment_instruction_id
  WHERE pi.submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM payment_gateway_transactions
WHERE payment_instruction_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM reconciliation_attempts
WHERE payment_instruction_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM reconciliations
WHERE payment_instruction_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM payment_proofs
WHERE payment_instruction_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM payment_approvals
WHERE payment_instruction_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM audit_logs
WHERE (entity='payment_instruction' AND entity_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
))
OR (entity='payroll_submission' AND entity_id LIKE 'SUB-E2PAY-UAT-%')
OR action LIKE 'E2PAY_UAT_%';

DELETE FROM payment_instruction_lines
WHERE payment_instruction_id IN (
  SELECT id FROM payment_instructions WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM payment_instructions
WHERE submission_id LIKE 'SUB-E2PAY-UAT-%';

DELETE FROM payroll_bank_snapshots
WHERE submission_id LIKE 'SUB-E2PAY-UAT-%';

DELETE FROM ewa_requests
WHERE payroll_submission_id LIKE 'SUB-E2PAY-UAT-%'
   OR employee_id LIKE 'EMP-E2PAY-UAT-%'
   OR client_id LIKE 'CLI-E2PAY-UAT-%';

DELETE FROM payroll_intake_missing_resolutions
WHERE employee_id LIKE 'EMP-E2PAY-UAT-%'
   OR batch_id IN (
     SELECT id FROM payroll_upload_batches WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
   );

DELETE FROM employee_master_history
WHERE employee_id LIKE 'EMP-E2PAY-UAT-%'
   OR source_batch_id IN (
     SELECT id FROM payroll_upload_batches WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
   );

DELETE FROM payroll_upload_rows
WHERE batch_id IN (
  SELECT id FROM payroll_upload_batches WHERE submission_id LIKE 'SUB-E2PAY-UAT-%'
);

DELETE FROM payroll_upload_batches
WHERE submission_id LIKE 'SUB-E2PAY-UAT-%';

DELETE FROM payroll_exceptions
WHERE submission_id LIKE 'SUB-E2PAY-UAT-%';

DELETE FROM submission_versions
WHERE submission_id LIKE 'SUB-E2PAY-UAT-%';

DELETE FROM payroll_run_lines
WHERE submission_id LIKE 'SUB-E2PAY-UAT-%';

DELETE FROM payroll_submissions
WHERE id LIKE 'SUB-E2PAY-UAT-%';

-- Remove only dedicated E2Pay UAT master records, never shared/real records.
DELETE FROM user_project_scopes WHERE project_id LIKE 'PRJ-E2PAY-UAT-%';
DELETE FROM user_client_scopes WHERE client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM integration_sync_runs
WHERE connection_id IN (SELECT id FROM integration_connections WHERE client_id LIKE 'CLI-E2PAY-UAT-%');
DELETE FROM integration_connections WHERE client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM portal_ads WHERE client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM portal_settings WHERE client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM ewa_policies WHERE client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM billing_rules WHERE client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM billing_sla_policies WHERE client_id LIKE 'CLI-E2PAY-UAT-%';

DELETE FROM payroll_bank_snapshots WHERE employee_id LIKE 'EMP-E2PAY-UAT-%';
DELETE FROM employees WHERE id LIKE 'EMP-E2PAY-UAT-%';
DELETE FROM client_service_plans WHERE id LIKE 'SP-E2PAY-UAT-%' OR client_id LIKE 'CLI-E2PAY-UAT-%';
DELETE FROM projects WHERE id LIKE 'PRJ-E2PAY-UAT-%';
DELETE FROM clients WHERE id LIKE 'CLI-E2PAY-UAT-%';

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
