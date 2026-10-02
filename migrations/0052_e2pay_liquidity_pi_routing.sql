PRAGMA foreign_keys = ON;

ALTER TABLE payment_instructions ADD COLUMN provider_account_registry_id TEXT REFERENCES payment_provider_accounts(id);
ALTER TABLE payment_instructions ADD COLUMN provider TEXT;
ALTER TABLE payment_instructions ADD COLUMN provider_environment TEXT;
ALTER TABLE payment_instructions ADD COLUMN provider_sub_account_id TEXT;
ALTER TABLE payment_instructions ADD COLUMN provider_account_snapshot TEXT;
ALTER TABLE payment_instructions ADD COLUMN provider_balance_snapshot REAL;
ALTER TABLE payment_instructions ADD COLUMN provider_available_balance_snapshot REAL;
ALTER TABLE payment_instructions ADD COLUMN provider_balance_checked_at TEXT;

ALTER TABLE payment_gateway_transactions ADD COLUMN provider_account_registry_id TEXT REFERENCES payment_provider_accounts(id);
ALTER TABLE payment_gateway_transactions ADD COLUMN provider_sub_account_last4 TEXT;

CREATE INDEX IF NOT EXISTS idx_pi_provider_account
  ON payment_instructions(org_id,client_id,provider,provider_environment,provider_account_registry_id);

CREATE INDEX IF NOT EXISTS idx_gateway_provider_account
  ON payment_gateway_transactions(provider_account_registry_id,created_at DESC);

CREATE TRIGGER IF NOT EXISTS payment_instruction_provider_snapshot_immutable
BEFORE UPDATE OF provider_account_registry_id,provider,provider_environment,provider_sub_account_id,
  provider_account_snapshot,provider_balance_snapshot,provider_available_balance_snapshot,provider_balance_checked_at
ON payment_instructions
WHEN
  COALESCE(OLD.provider_account_registry_id,'')<>COALESCE(NEW.provider_account_registry_id,'')
  OR COALESCE(OLD.provider,'')<>COALESCE(NEW.provider,'')
  OR COALESCE(OLD.provider_environment,'')<>COALESCE(NEW.provider_environment,'')
  OR COALESCE(OLD.provider_sub_account_id,'')<>COALESCE(NEW.provider_sub_account_id,'')
  OR COALESCE(OLD.provider_account_snapshot,'')<>COALESCE(NEW.provider_account_snapshot,'')
  OR COALESCE(OLD.provider_balance_snapshot,-1)<>COALESCE(NEW.provider_balance_snapshot,-1)
  OR COALESCE(OLD.provider_available_balance_snapshot,-1)<>COALESCE(NEW.provider_available_balance_snapshot,-1)
  OR COALESCE(OLD.provider_balance_checked_at,'')<>COALESCE(NEW.provider_balance_checked_at,'')
BEGIN
  SELECT RAISE(ABORT,'Payment instruction provider routing snapshot is immutable');
END;
