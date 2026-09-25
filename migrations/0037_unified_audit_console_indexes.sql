PRAGMA foreign_keys = ON;

-- Unified Audit Logs console indexes.
-- Additive only: improves organization-scoped chronological audit queries.
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_timestamp
  ON audit_logs(org_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action_timestamp
  ON audit_logs(org_id, action, timestamp DESC);
