PRAGMA foreign_keys = ON;

-- Payroll lines become immutable as soon as the Processor hands the snapshot to
-- Controller. A rejected review returns the submission to REVISION_REQUIRED,
-- where edits are allowed again and a new bank fingerprint is captured.
DROP TRIGGER IF EXISTS payroll_run_lines_locked_update;

CREATE TRIGGER payroll_run_lines_locked_update
BEFORE UPDATE ON payroll_run_lines
WHEN EXISTS (
  SELECT 1 FROM payroll_submissions s WHERE s.id=OLD.submission_id
    AND (s.period_status='CLOSED' OR s.state IN (
      'CONTROLLER_REVIEW','DATA_APPROVED','PAYROLL_FINALIZED',
      'PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT',
      'DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED'
    ))
)
BEGIN
  SELECT RAISE(ABORT,'payroll run snapshot is locked');
END;
