-- Client consent is separate from internal approval. Existing requests are not auto-approved.
ALTER TABLE ewa_requests ADD COLUMN client_approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(client_approval_status IN ('PENDING','APPROVED','REJECTED'));
ALTER TABLE ewa_requests ADD COLUMN client_approved_by TEXT;
ALTER TABLE ewa_requests ADD COLUMN client_decided_at TEXT;
ALTER TABLE ewa_requests ADD COLUMN client_decision_note TEXT;
CREATE TRIGGER ewa_requires_client_approval
BEFORE UPDATE OF status ON ewa_requests
WHEN NEW.status='APPROVED' AND (NEW.client_approval_status<>'APPROVED' OR NEW.client_approved_by IS NULL)
BEGIN
  SELECT RAISE(ABORT,'EWA_CLIENT_APPROVAL_REQUIRED');
END;
