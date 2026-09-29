PRAGMA foreign_keys = ON;

-- P2 Security Hardening & Defense-in-Depth
-- Session anomaly tracking, D1 fail-safe rate limiting and audit-integrity checkpoints.

ALTER TABLE app_sessions ADD COLUMN current_ip_hash TEXT;
ALTER TABLE app_sessions ADD COLUMN current_device_hash TEXT;
ALTER TABLE app_sessions ADD COLUMN anomaly_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_sessions ADD COLUMN last_anomaly_at TEXT;

UPDATE app_sessions
SET current_ip_hash=COALESCE(current_ip_hash,ip_hash),
    current_device_hash=COALESCE(current_device_hash,device_hash);

CREATE TABLE IF NOT EXISTS security_rate_limits (
  rate_key TEXT NOT NULL,
  window_epoch INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1 CHECK(request_count >= 1),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(rate_key,window_epoch)
);

CREATE INDEX IF NOT EXISTS idx_security_rate_limits_window
  ON security_rate_limits(window_epoch);

CREATE TABLE IF NOT EXISTS security_audit_checkpoints (
  checkpoint_date TEXT PRIMARY KEY,
  row_count INTEGER NOT NULL CHECK(row_count >= 0),
  first_timestamp TEXT,
  last_timestamp TEXT,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  verified_at TEXT,
  verification_status TEXT NOT NULL DEFAULT 'SEALED'
    CHECK(verification_status IN ('SEALED','VERIFIED','MISMATCH')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_security_audit_checkpoints_status
  ON security_audit_checkpoints(verification_status,checkpoint_date DESC);
