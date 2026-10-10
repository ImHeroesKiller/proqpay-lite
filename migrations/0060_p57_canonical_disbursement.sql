PRAGMA foreign_keys = ON;

-- P5.7.4 Canonical Disbursement Request
-- Business intent and beneficiary snapshots become immutable once a request is READY.
CREATE TRIGGER IF NOT EXISTS disbursement_request_business_intent_immutable
BEFORE UPDATE OF
  org_id,client_id,project_id,provider,provider_account_registry_id,
  provider_sub_account_id_snapshot,provider_environment,purpose,destination_mode,
  beneficiary_type,source_document_type,source_document_id,amount,currency,
  recipient_count,client_reference,idempotency_key,routing_hash
ON disbursement_requests
WHEN OLD.status <> 'DRAFT'
AND (
  COALESCE(OLD.org_id,'')<>COALESCE(NEW.org_id,'')
  OR COALESCE(OLD.client_id,'')<>COALESCE(NEW.client_id,'')
  OR COALESCE(OLD.project_id,'')<>COALESCE(NEW.project_id,'')
  OR COALESCE(OLD.provider,'')<>COALESCE(NEW.provider,'')
  OR COALESCE(OLD.provider_account_registry_id,'')<>COALESCE(NEW.provider_account_registry_id,'')
  OR COALESCE(OLD.provider_sub_account_id_snapshot,'')<>COALESCE(NEW.provider_sub_account_id_snapshot,'')
  OR COALESCE(OLD.provider_environment,'')<>COALESCE(NEW.provider_environment,'')
  OR COALESCE(OLD.purpose,'')<>COALESCE(NEW.purpose,'')
  OR COALESCE(OLD.destination_mode,'')<>COALESCE(NEW.destination_mode,'')
  OR COALESCE(OLD.beneficiary_type,'')<>COALESCE(NEW.beneficiary_type,'')
  OR COALESCE(OLD.source_document_type,'')<>COALESCE(NEW.source_document_type,'')
  OR COALESCE(OLD.source_document_id,'')<>COALESCE(NEW.source_document_id,'')
  OR OLD.amount<>NEW.amount
  OR COALESCE(OLD.currency,'')<>COALESCE(NEW.currency,'')
  OR OLD.recipient_count<>NEW.recipient_count
  OR COALESCE(OLD.client_reference,'')<>COALESCE(NEW.client_reference,'')
  OR COALESCE(OLD.idempotency_key,'')<>COALESCE(NEW.idempotency_key,'')
  OR COALESCE(OLD.routing_hash,'')<>COALESCE(NEW.routing_hash,'')
)
BEGIN
  SELECT RAISE(ABORT,'Ready disbursement business intent is immutable');
END;

CREATE TRIGGER IF NOT EXISTS disbursement_item_snapshot_immutable_ready
BEFORE UPDATE ON disbursement_request_items
WHEN EXISTS (
  SELECT 1 FROM disbursement_requests dr
  WHERE dr.id=OLD.disbursement_request_id AND dr.status <> 'DRAFT'
)
BEGIN
  SELECT RAISE(ABORT,'Ready disbursement beneficiary snapshot is immutable');
END;

CREATE TRIGGER IF NOT EXISTS disbursement_item_delete_immutable_ready
BEFORE DELETE ON disbursement_request_items
WHEN EXISTS (
  SELECT 1 FROM disbursement_requests dr
  WHERE dr.id=OLD.disbursement_request_id AND dr.status <> 'DRAFT'
)
BEGIN
  SELECT RAISE(ABORT,'Ready disbursement beneficiary snapshot cannot be deleted');
END;
