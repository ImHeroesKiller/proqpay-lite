PRAGMA foreign_keys = ON;

-- P5.7.3 Async Client & Payment Readiness
-- A Payment Instruction may be prepared before provider provisioning completes.
-- Provider routing may be bound exactly once while the PI is still READY to submit;
-- after binding (or after submission) the routing snapshot remains immutable.
DROP TRIGGER IF EXISTS payment_instruction_provider_routing_immutable;

CREATE TRIGGER IF NOT EXISTS payment_instruction_provider_routing_immutable
BEFORE UPDATE OF provider_account_registry_id,provider,provider_environment,provider_sub_account_id,provider_account_snapshot
ON payment_instructions
WHEN
  (
    OLD.status <> 'PAYMENT_INSTRUCTION_READY'
    OR OLD.provider_account_registry_id IS NOT NULL
    OR OLD.provider IS NOT NULL
    OR OLD.provider_environment IS NOT NULL
    OR OLD.provider_sub_account_id IS NOT NULL
    OR OLD.provider_account_snapshot IS NOT NULL
  )
  AND (
    COALESCE(OLD.provider_account_registry_id,'')<>COALESCE(NEW.provider_account_registry_id,'')
    OR COALESCE(OLD.provider,'')<>COALESCE(NEW.provider,'')
    OR COALESCE(OLD.provider_environment,'')<>COALESCE(NEW.provider_environment,'')
    OR COALESCE(OLD.provider_sub_account_id,'')<>COALESCE(NEW.provider_sub_account_id,'')
    OR COALESCE(OLD.provider_account_snapshot,'')<>COALESCE(NEW.provider_account_snapshot,'')
  )
BEGIN
  SELECT RAISE(ABORT,'Payment instruction provider routing snapshot is immutable');
END;
