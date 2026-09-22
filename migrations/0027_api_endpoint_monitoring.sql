PRAGMA foreign_keys = ON;

-- Observability only. These headers identify an external consumer for monitoring;
-- they do not grant access and never replace the endpoint's normal authentication.
CREATE TABLE api_connected_apps (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  app_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OBSERVED'
    CHECK (status IN ('OBSERVED','ACTIVE','INACTIVE','REVOKED')),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_endpoint TEXT,
  last_status_code INTEGER,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  data_pull_count INTEGER NOT NULL DEFAULT 0 CHECK (data_pull_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  user_agent TEXT,
  UNIQUE (org_id, app_id)
);

CREATE INDEX idx_api_connected_apps_last_seen
  ON api_connected_apps(org_id, last_seen_at DESC);

CREATE TABLE api_endpoint_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  app_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('CONNECTION','DATA_PULL','REQUEST')),
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_api_endpoint_events_org_created
  ON api_endpoint_events(org_id, created_at DESC);
CREATE INDEX idx_api_endpoint_events_app_created
  ON api_endpoint_events(org_id, app_id, created_at DESC);
CREATE INDEX idx_api_endpoint_events_endpoint_created
  ON api_endpoint_events(org_id, endpoint, created_at DESC);
