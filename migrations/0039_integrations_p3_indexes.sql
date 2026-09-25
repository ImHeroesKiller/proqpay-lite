PRAGMA foreign_keys = ON;

-- P3 Integrations performance indexes for common operational filters.
CREATE INDEX IF NOT EXISTS idx_api_endpoint_events_type_created
  ON api_endpoint_events(org_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_endpoint_events_status_created
  ON api_endpoint_events(org_id, status_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_connected_apps_status_seen
  ON api_connected_apps(org_id, status, last_seen_at DESC);
