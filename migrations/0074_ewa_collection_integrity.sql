-- No historical loan is backfilled or declared collected by this migration.
-- A primary key per loan is the atomic claim across regular/off-cycle pay runs.
CREATE TABLE ewa_repayment_allocations (
  ewa_request_id TEXT PRIMARY KEY REFERENCES ewa_requests(id),
  org_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES payroll_submissions(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  line_id TEXT NOT NULL REFERENCES payroll_run_lines(id),
  principal INTEGER NOT NULL CHECK(principal>0),
  fee INTEGER NOT NULL CHECK(fee>=0),
  total INTEGER NOT NULL CHECK(total=principal+fee),
  base_net INTEGER NOT NULL,
  base_deduction INTEGER NOT NULL,
  base_components TEXT NOT NULL,
  applied_net INTEGER NOT NULL CHECK(applied_net=base_net-total AND applied_net>0),
  applied_deduction INTEGER NOT NULL CHECK(applied_deduction=base_deduction+total),
  applied_components TEXT NOT NULL,
  payment_instruction_id TEXT REFERENCES payment_instructions(id),
  collected_at TEXT,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(submission_id,employee_id)
);
CREATE UNIQUE INDEX ewa_allocations_line ON ewa_repayment_allocations(line_id);

CREATE TRIGGER ewa_allocation_validate BEFORE INSERT ON ewa_repayment_allocations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM ewa_requests r
    JOIN employees employee ON employee.id=r.employee_id AND employee.org_id=r.org_id AND employee.client_id=r.client_id
    JOIN payroll_submissions s ON s.id=NEW.submission_id AND s.org_id=r.org_id AND s.client_id=r.client_id
    JOIN payroll_run_lines l ON l.id=NEW.line_id AND l.submission_id=s.id AND l.employee_id=r.employee_id
    WHERE r.id=NEW.ewa_request_id AND r.org_id=NEW.org_id AND r.client_id=NEW.client_id
      AND r.employee_id=NEW.employee_id AND r.status='DISBURSED' AND r.payroll_submission_id IS NULL
      AND r.amount=NEW.principal AND r.fee=NEW.fee AND r.repayment=NEW.total AND r.period<=s.period
      AND s.period_status<>'CLOSED' AND s.state IN ('DRAFT','SUBMITTED','INGESTING','AI_VALIDATING','EXCEPTION_FOUND','CLIENT_ACTION_REQUIRED','CLIENT_RESUBMITTED','REVISION_REQUIRED','CLIENT_REVISION_REQUESTED')
      AND l.included=1 AND l.net_amount=NEW.base_net AND l.deduction_amount=NEW.base_deduction
      AND COALESCE(l.components,'{}')=NEW.base_components
  ) OR NEW.payment_instruction_id IS NOT NULL OR NEW.collected_at IS NOT NULL
  THEN RAISE(ABORT,'EWA_ALLOCATION_CONFLICT') END;
END;

-- The claim, deduction, loan status and audit are one SQLite statement/transaction.
CREATE TRIGGER ewa_allocation_apply AFTER INSERT ON ewa_repayment_allocations
BEGIN
  UPDATE payroll_run_lines SET net_amount=NEW.applied_net,deduction_amount=NEW.applied_deduction,
    components=NEW.applied_components,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.line_id;
  UPDATE ewa_requests SET status='REPAYING',payroll_submission_id=NEW.submission_id,
    applied_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.ewa_request_id;
  INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
    VALUES('AUD-EWA-ALLOC-'||NEW.ewa_request_id,NEW.org_id,'SYSTEM','SYSTEM','EWA_REPAYMENT_ALLOCATED',
      json_object('submissionId',NEW.submission_id,'employeeId',NEW.employee_id,'principal',NEW.principal,'fee',NEW.fee,'total',NEW.total),'ewa_request',NEW.ewa_request_id);
END;

-- A paid, immutable PI must contain this exact employee's allocated net, and
-- the reconciliation must prove the complete instruction totals/counts.
CREATE VIEW ewa_repayment_collection_evidence AS
SELECT a.ewa_request_id,pi.id AS payment_instruction_id
FROM ewa_repayment_allocations a
JOIN ewa_requests r ON r.id=a.ewa_request_id AND r.org_id=a.org_id AND r.client_id=a.client_id
  AND r.employee_id=a.employee_id AND r.payroll_submission_id=a.submission_id
  AND r.amount=a.principal AND r.fee=a.fee AND r.repayment=a.total
JOIN payroll_run_lines l ON l.id=a.line_id AND l.submission_id=a.submission_id AND l.employee_id=a.employee_id
  AND l.included=1 AND l.net_amount=a.applied_net AND l.deduction_amount=a.applied_deduction AND l.components=a.applied_components
JOIN payment_instructions pi ON pi.submission_id=a.submission_id AND pi.org_id=a.org_id AND pi.client_id=a.client_id
  AND pi.status='COMPLETED' AND COALESCE(pi.content_hash,'')<>''
JOIN reconciliations rec ON rec.payment_instruction_id=pi.id AND rec.status='MATCHED' AND rec.difference=0
  AND rec.expected_total=pi.expected_total AND rec.instruction_total=pi.expected_total AND rec.proof_total=pi.expected_total
WHERE pi.recipient_count>0
  AND (SELECT COUNT(*) FROM payment_instruction_lines p WHERE p.payment_instruction_id=pi.id)=pi.recipient_count
  AND (SELECT SUM(p.amount) FROM payment_instruction_lines p WHERE p.payment_instruction_id=pi.id)=pi.expected_total
  AND (SELECT COUNT(*) FROM payment_instruction_lines p WHERE p.payment_instruction_id=pi.id AND p.employee_id=a.employee_id)=1
  AND EXISTS(SELECT 1 FROM payment_instruction_lines p WHERE p.payment_instruction_id=pi.id AND p.employee_id=a.employee_id AND p.amount=a.applied_net);

CREATE TRIGGER ewa_allocation_no_delete BEFORE DELETE ON ewa_repayment_allocations
BEGIN SELECT RAISE(ABORT,'EWA_ALLOCATION_IMMUTABLE'); END;

CREATE TRIGGER ewa_allocation_collect_guard BEFORE UPDATE ON ewa_repayment_allocations
BEGIN
  SELECT CASE WHEN OLD.collected_at IS NOT NULL OR NEW.collected_at IS NULL
    OR NEW.ewa_request_id IS NOT OLD.ewa_request_id OR NEW.org_id IS NOT OLD.org_id
    OR NEW.client_id IS NOT OLD.client_id OR NEW.submission_id IS NOT OLD.submission_id
    OR NEW.employee_id IS NOT OLD.employee_id OR NEW.line_id IS NOT OLD.line_id
    OR NEW.principal IS NOT OLD.principal OR NEW.fee IS NOT OLD.fee OR NEW.total IS NOT OLD.total
    OR NEW.base_net IS NOT OLD.base_net OR NEW.base_deduction IS NOT OLD.base_deduction
    OR NEW.base_components IS NOT OLD.base_components OR NEW.applied_net IS NOT OLD.applied_net
    OR NEW.applied_deduction IS NOT OLD.applied_deduction OR NEW.applied_components IS NOT OLD.applied_components
    OR NEW.created_at IS NOT OLD.created_at
    OR NOT EXISTS(SELECT 1 FROM ewa_repayment_collection_evidence e
      WHERE e.ewa_request_id=OLD.ewa_request_id AND e.payment_instruction_id=NEW.payment_instruction_id)
  THEN RAISE(ABORT,'EWA_COLLECTION_EVIDENCE_REQUIRED') END;
END;

CREATE TRIGGER ewa_allocation_collected AFTER UPDATE ON ewa_repayment_allocations
BEGIN
  UPDATE ewa_requests SET status='REPAID',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.ewa_request_id AND status='REPAYING';
  INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
    VALUES('AUD-EWA-COLLECT-'||NEW.ewa_request_id,NEW.org_id,'SYSTEM','SYSTEM','EWA_REPAID_RECONCILED',
      json_object('submissionId',NEW.submission_id,'paymentInstructionId',NEW.payment_instruction_id,'principal',NEW.principal,'fee',NEW.fee,'total',NEW.total),'ewa_request',NEW.ewa_request_id);
END;

CREATE TRIGGER ewa_collection_status_guard BEFORE UPDATE OF status ON ewa_requests
WHEN NEW.status='REPAID' AND OLD.status<>'REPAID'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ewa_repayment_allocations a
    JOIN ewa_repayment_collection_evidence e ON e.ewa_request_id=a.ewa_request_id AND e.payment_instruction_id=a.payment_instruction_id
    WHERE a.ewa_request_id=NEW.id AND a.collected_at IS NOT NULL)
  THEN RAISE(ABORT,'EWA_COLLECTION_EVIDENCE_REQUIRED') END;
END;

CREATE TRIGGER ewa_allocated_line_guard BEFORE UPDATE ON payroll_run_lines
WHEN EXISTS(SELECT 1 FROM ewa_repayment_allocations a WHERE a.line_id=OLD.id AND (
  NEW.id IS NOT a.line_id OR NEW.submission_id IS NOT a.submission_id OR NEW.employee_id IS NOT a.employee_id
  OR NEW.included<>1 OR NEW.net_amount IS NOT a.applied_net OR NEW.deduction_amount IS NOT a.applied_deduction
  OR NEW.gross_amount IS NOT OLD.gross_amount OR NEW.components IS NOT a.applied_components))
BEGIN SELECT RAISE(ABORT,'EWA_ALLOCATED_PAYROLL_LINE_LOCKED'); END;

CREATE TRIGGER ewa_allocated_line_no_delete BEFORE DELETE ON payroll_run_lines
WHEN EXISTS(SELECT 1 FROM ewa_repayment_allocations WHERE line_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'EWA_ALLOCATED_PAYROLL_LINE_LOCKED'); END;

CREATE TRIGGER ewa_allocated_submission_guard BEFORE UPDATE ON payroll_submissions
WHEN EXISTS(SELECT 1 FROM ewa_repayment_allocations a WHERE a.submission_id=OLD.id) AND (
  NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.client_id IS NOT OLD.client_id
  OR NEW.period IS NOT OLD.period OR NEW.state='CANCELLED')
BEGIN SELECT RAISE(ABORT,'EWA_ALLOCATED_PAYROLL_LINE_LOCKED'); END;

CREATE TRIGGER ewa_allocated_submission_no_delete BEFORE DELETE ON payroll_submissions
WHEN EXISTS(SELECT 1 FROM ewa_repayment_allocations a WHERE a.submission_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'EWA_ALLOCATED_PAYROLL_LINE_LOCKED'); END;

CREATE TRIGGER ewa_allocated_loan_guard BEFORE UPDATE ON ewa_requests
WHEN EXISTS(SELECT 1 FROM ewa_repayment_allocations a WHERE a.ewa_request_id=OLD.id AND (
  NEW.id IS NOT OLD.id OR NEW.org_id IS NOT a.org_id OR NEW.client_id IS NOT a.client_id
  OR NEW.employee_id IS NOT a.employee_id OR NEW.payroll_submission_id IS NOT a.submission_id
  OR NEW.amount IS NOT a.principal OR NEW.fee IS NOT a.fee OR NEW.repayment IS NOT a.total
  OR NEW.status NOT IN ('REPAYING','REPAID') OR (OLD.status='REPAID' AND NEW.status<>'REPAID')))
BEGIN SELECT RAISE(ABORT,'EWA_ALLOCATION_IMMUTABLE'); END;
