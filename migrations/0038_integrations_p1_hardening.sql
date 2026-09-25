PRAGMA foreign_keys = ON;

-- Integration P1 hardening:
-- 1) separate draft gateway configuration from the active execution profile,
-- 2) record explicit activation/testing metadata,
-- 3) add trusted-app lifecycle metadata,
-- 4) make API/audit events traceable through one correlation id.

ALTER TABLE gateway_secure_settings ADD COLUMN draft_provider TEXT
  CHECK (draft_provider IS NULL OR draft_provider IN ('UNCONFIGURED','E2PAY'));
ALTER TABLE gateway_secure_settings ADD COLUMN draft_environment TEXT
  CHECK (draft_environment IS NULL OR draft_environment IN ('UAT','PRODUCTION'));
ALTER TABLE gateway_secure_settings ADD COLUMN activated_by TEXT;
ALTER TABLE gateway_secure_settings ADD COLUMN activated_at TEXT;
ALTER TABLE gateway_secure_settings ADD COLUMN last_tested_environment TEXT
  CHECK (last_tested_environment IS NULL OR last_tested_environment IN ('UAT','PRODUCTION'));
ALTER TABLE gateway_secure_settings ADD COLUMN last_tested_at TEXT;
ALTER TABLE gateway_secure_settings ADD COLUMN last_tested_by TEXT;

UPDATE gateway_secure_settings
SET draft_provider=COALESCE(draft_provider,provider),
    draft_environment=COALESCE(draft_environment,environment)
WHERE draft_provider IS NULL OR draft_environment IS NULL;

ALTER TABLE api_connected_apps ADD COLUMN status_updated_by TEXT;
ALTER TABLE api_connected_apps ADD COLUMN status_updated_at TEXT;

ALTER TABLE api_endpoint_events ADD COLUMN correlation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_api_endpoint_events_correlation
  ON api_endpoint_events(org_id, correlation_id, created_at DESC);

ALTER TABLE audit_logs ADD COLUMN correlation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation
  ON audit_logs(org_id, correlation_id, timestamp DESC);
