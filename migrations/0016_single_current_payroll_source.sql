-- Only one upload batch may be the current imported source for a submission.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_upload_current_source
ON payroll_upload_batches(submission_id)
WHERE status='IMPORTED';
