PRAGMA foreign_keys = ON;

-- Fail-closed and transaction-serialized: the second strategy cannot create its
-- financial ledger even when two requests race after separate API prechecks.
-- Legacy rows are NOT deleted, converted, or retried by this migration.
CREATE TRIGGER IF NOT EXISTS p0a_canonical_pi_excludes_legacy_gateway
BEFORE INSERT ON disbursement_requests
WHEN NEW.source_document_type='PAYMENT_INSTRUCTION'
  AND EXISTS (SELECT 1 FROM payment_gateway_transactions pgt
    WHERE pgt.org_id=NEW.org_id AND pgt.payment_instruction_id=NEW.source_document_id)
BEGIN
  SELECT RAISE(ABORT,'PAYMENT_SOURCE_ALREADY_EXECUTED_IN_LEGACY');
END;

CREATE TRIGGER IF NOT EXISTS p0a_legacy_gateway_excludes_canonical_pi
BEFORE INSERT ON payment_gateway_transactions
WHEN NEW.payment_instruction_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM disbursement_requests dr
    WHERE dr.org_id=NEW.org_id
      AND dr.source_document_type='PAYMENT_INSTRUCTION'
      AND dr.source_document_id=NEW.payment_instruction_id
      AND (dr.status NOT IN ('REJECTED','CANCELLED') OR EXISTS (SELECT 1 FROM disbursement_executions de WHERE de.disbursement_request_id=dr.id)))
BEGIN
  SELECT RAISE(ABORT,'PAYMENT_SOURCE_CANONICAL_STRATEGY_LOCKED');
END;

CREATE TRIGGER IF NOT EXISTS p0a_legacy_ewa_excludes_canonical_dr
BEFORE UPDATE OF status ON ewa_requests
WHEN NEW.status='DISBURSED' AND OLD.status<>'DISBURSED'
  AND EXISTS (SELECT 1 FROM disbursement_requests dr
    WHERE dr.org_id=NEW.org_id AND dr.source_document_type='EWA_REQUEST'
      AND dr.source_document_id=NEW.id
      AND (dr.status NOT IN ('REJECTED','CANCELLED') OR EXISTS (SELECT 1 FROM disbursement_executions de WHERE de.disbursement_request_id=dr.id)))
BEGIN
  SELECT RAISE(ABORT,'EWA_CANONICAL_DISBURSEMENT_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS p0a_canonical_ewa_excludes_legacy_paid
BEFORE INSERT ON disbursement_requests
WHEN NEW.source_document_type='EWA_REQUEST'
  AND EXISTS (SELECT 1 FROM ewa_requests er
    WHERE er.org_id=NEW.org_id AND er.id=NEW.source_document_id
      AND er.status IN ('DISBURSED','REPAYING','REPAID'))
BEGIN
  SELECT RAISE(ABORT,'EWA_ALREADY_PAID_IN_LEGACY');
END;
