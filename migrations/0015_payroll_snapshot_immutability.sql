-- Database-level immutability for final payroll snapshots and accepted source evidence.
CREATE TRIGGER IF NOT EXISTS trg_payroll_run_lines_no_update_after_final
BEFORE UPDATE ON payroll_run_lines
WHEN EXISTS (
  SELECT 1 FROM payroll_submissions s
  WHERE s.id=OLD.submission_id
    AND (s.period_status='CLOSED' OR s.state IN (
      'PAYROLL_FINALIZED','PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING',
      'APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED',
      'RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED'
    ))
)
BEGIN
  SELECT RAISE(ABORT, 'FINAL_PAYROLL_SNAPSHOT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_payroll_run_lines_no_delete_after_final
BEFORE DELETE ON payroll_run_lines
WHEN EXISTS (
  SELECT 1 FROM payroll_submissions s
  WHERE s.id=OLD.submission_id
    AND (s.period_status='CLOSED' OR s.state IN (
      'PAYROLL_FINALIZED','PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING',
      'APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED',
      'RECONCILIATION','PAYMENT_EXCEPTION','COMPLETED'
    ))
)
BEGIN
  SELECT RAISE(ABORT, 'FINAL_PAYROLL_SNAPSHOT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_payroll_upload_rows_immutable_update
BEFORE UPDATE ON payroll_upload_rows
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_SOURCE_ROW_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_payroll_upload_rows_immutable_delete
BEFORE DELETE ON payroll_upload_rows
BEGIN
  SELECT RAISE(ABORT, 'PAYROLL_SOURCE_ROW_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_payroll_upload_batch_no_delete_imported
BEFORE DELETE ON payroll_upload_batches
WHEN OLD.status='IMPORTED'
BEGIN
  SELECT RAISE(ABORT, 'IMPORTED_PAYROLL_SOURCE_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_payroll_upload_batch_no_rewrite_imported
BEFORE UPDATE OF original_filename,r2_object_key,file_sha256,template_version,uploaded_by,uploaded_at,source_total_gross,source_total_deduction,source_total_net ON payroll_upload_batches
WHEN OLD.status='IMPORTED'
BEGIN
  SELECT RAISE(ABORT, 'IMPORTED_PAYROLL_SOURCE_IMMUTABLE');
END;
