PRAGMA foreign_keys = ON;

-- Phase 5: explicit client payroll approval checkpoint.
-- Approval metadata is stored on the submission for fast UI reads; audit_logs
-- remains the immutable event trail for every decision.
ALTER TABLE payroll_submissions ADD COLUMN client_reviewed_at TEXT;
ALTER TABLE payroll_submissions ADD COLUMN client_reviewed_by TEXT;
ALTER TABLE payroll_submissions ADD COLUMN client_review_note TEXT;
ALTER TABLE payroll_submissions ADD COLUMN client_review_decision TEXT
  CHECK (client_review_decision IS NULL OR client_review_decision IN ('APPROVED','REVISION_REQUESTED'));

-- Controller hand-off and client-approved snapshots must stay immutable.
-- CLIENT_REVISION_REQUESTED is intentionally excluded so Processor can correct
-- the payroll and restart validation/review.
DROP TRIGGER IF EXISTS payroll_run_lines_locked_update;

CREATE TRIGGER payroll_run_lines_locked_update
BEFORE UPDATE ON payroll_run_lines
WHEN EXISTS (
  SELECT 1 FROM payroll_submissions s WHERE s.id=OLD.submission_id
    AND (s.period_status='CLOSED' OR s.state IN (
      'CONTROLLER_REVIEW','DATA_APPROVED','PAYROLL_FINALIZED',
      'CLIENT_APPROVAL_PENDING','CLIENT_APPROVED',
      'PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT',
      'DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED'
    ))
)
BEGIN
  SELECT RAISE(ABORT,'payroll run snapshot is locked');
END;
