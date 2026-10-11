PRAGMA foreign_keys = ON;

-- P5.7.5 Provider Channel Router
-- Channel mapping is configuration, not provider execution. It is resolved and
-- snapshotted before Controller approval, then becomes immutable.
ALTER TABLE provider_channel_mappings ADD COLUMN contract_version TEXT NOT NULL DEFAULT '1';
ALTER TABLE provider_channel_mappings ADD COLUMN config_hash TEXT;
ALTER TABLE provider_channel_mappings ADD COLUMN confirmed_by TEXT;
ALTER TABLE provider_channel_mappings ADD COLUMN confirmed_at TEXT;
ALTER TABLE provider_channel_mappings ADD COLUMN confirmation_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_provider_channel_effective
  ON provider_channel_mappings(provider,environment,purpose,destination_mode,beneficiary_type,mapping_status,effective_from,effective_until);

CREATE TRIGGER IF NOT EXISTS provider_channel_mapping_active_insert_requires_confirmation
BEFORE INSERT ON provider_channel_mappings
WHEN NEW.mapping_status='ACTIVE'
AND (NEW.confirmed_by IS NULL OR NEW.confirmed_at IS NULL OR NEW.config_hash IS NULL OR NEW.confirmation_reference IS NULL)
BEGIN
  SELECT RAISE(ABORT,'Active provider channel mapping requires confirmation evidence');
END;

CREATE TRIGGER IF NOT EXISTS provider_channel_mapping_active_requires_confirmation
BEFORE UPDATE OF mapping_status ON provider_channel_mappings
WHEN NEW.mapping_status='ACTIVE'
AND (NEW.confirmed_by IS NULL OR NEW.confirmed_at IS NULL OR NEW.config_hash IS NULL OR NEW.confirmation_reference IS NULL)
BEGIN
  SELECT RAISE(ABORT,'Active provider channel mapping requires confirmation evidence');
END;

CREATE TRIGGER IF NOT EXISTS disbursement_provider_channel_immutable_pending
BEFORE UPDATE OF provider_channel_mapping_id,provider_channel_snapshot
ON disbursement_requests
WHEN OLD.status IN (
  'PENDING_APPROVAL','APPROVED','EXECUTING','PROCESSING','PARTIALLY_SETTLED',
  'SETTLED','FAILED','RECONCILIATION_REQUIRED','RECONCILED'
)
AND (
  COALESCE(OLD.provider_channel_mapping_id,'')<>COALESCE(NEW.provider_channel_mapping_id,'')
  OR COALESCE(OLD.provider_channel_snapshot,'')<>COALESCE(NEW.provider_channel_snapshot,'')
)
BEGIN
  SELECT RAISE(ABORT,'Submitted disbursement provider channel is immutable');
END;
