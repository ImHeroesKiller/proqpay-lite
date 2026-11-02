-- Revalidate consent/status at the write boundary, including races after API reads.
CREATE TRIGGER ewa_dr_source_insert_guard BEFORE INSERT ON disbursement_requests
WHEN NEW.source_document_type='EWA_REQUEST'
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM ewa_requests r WHERE r.id=NEW.source_document_id
    AND r.org_id=NEW.org_id AND r.status IN ('DISBURSED','REPAYING','REPAID'))
    THEN RAISE(ABORT,'EWA_ALREADY_PAID_IN_LEGACY') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ewa_requests r WHERE r.id=NEW.source_document_id AND r.org_id=NEW.org_id
    AND r.client_id=NEW.client_id AND r.status='APPROVED' AND r.amount=NEW.amount
    AND r.client_approval_status='APPROVED' AND r.client_approved_by IS NOT NULL)
    THEN RAISE(ABORT,'DISBURSEMENT_EWA_SOURCE_CHANGED') END;
END;

CREATE TRIGGER ewa_dr_source_transition_guard BEFORE UPDATE OF status ON disbursement_requests
WHEN NEW.source_document_type='EWA_REQUEST' AND NEW.status IN ('PENDING_APPROVAL','APPROVED','EXECUTING','PROCESSING')
  AND NOT EXISTS(SELECT 1 FROM ewa_requests r WHERE r.id=NEW.source_document_id AND r.org_id=NEW.org_id
    AND r.client_id=NEW.client_id AND r.status='APPROVED' AND r.amount=NEW.amount
    AND r.client_approval_status='APPROVED' AND r.client_approved_by IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'DISBURSEMENT_EWA_SOURCE_CHANGED'); END;
