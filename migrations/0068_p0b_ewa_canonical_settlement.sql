PRAGMA foreign_keys = ON;

-- Replace the temporary P0.A block with provider-evidence-only canonical settlement.
-- This never permits manually typed transfer references to mark an EWA paid.
DROP TRIGGER IF EXISTS p0a_legacy_ewa_excludes_canonical_dr;
CREATE TRIGGER IF NOT EXISTS p0b_ewa_canonical_settlement_evidence
BEFORE UPDATE OF status ON ewa_requests
WHEN NEW.status='DISBURSED' AND OLD.status<>'DISBURSED'
  AND EXISTS (SELECT 1 FROM disbursement_requests dr
    WHERE dr.org_id=NEW.org_id AND dr.source_document_type='EWA_REQUEST' AND dr.source_document_id=NEW.id
      AND (dr.status NOT IN ('REJECTED','CANCELLED') OR EXISTS (SELECT 1 FROM disbursement_executions de WHERE de.disbursement_request_id=dr.id)))
  AND NOT (
    NEW.disbursement_source='E2PAY_CANONICAL'
    AND EXISTS (SELECT 1 FROM disbursement_requests dr
      JOIN disbursement_executions de ON de.disbursement_request_id=dr.id
      WHERE dr.org_id=NEW.org_id AND dr.source_document_type='EWA_REQUEST' AND dr.source_document_id=NEW.id
        AND dr.status IN ('SETTLED','RECONCILED') AND de.status='SUCCEEDED'
        AND (SELECT COUNT(*) FROM disbursement_execution_items dei WHERE dei.disbursement_execution_id=de.id)>0
        AND NOT EXISTS(SELECT 1 FROM disbursement_execution_items dei
          WHERE dei.disbursement_execution_id=de.id AND dei.status<>'SUCCEEDED'))
  )
BEGIN
  SELECT RAISE(ABORT,'EWA_CANONICAL_DISBURSEMENT_REQUIRED');
END;
