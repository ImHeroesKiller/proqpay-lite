PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payment_gateway_provider_snapshots (
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  account_id TEXT,
  account_name TEXT,
  merchant_status TEXT,
  account_type_name TEXT,
  account_group_name TEXT,
  balance REAL,
  phone_masked TEXT,
  bank_count INTEGER,
  source TEXT NOT NULL DEFAULT 'PROVIDER',
  refreshed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (org_id, provider, environment)
);

CREATE INDEX IF NOT EXISTS idx_gateway_provider_snapshot_refreshed
  ON payment_gateway_provider_snapshots(org_id, provider, environment, refreshed_at DESC);
