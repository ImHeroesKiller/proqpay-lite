PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payment_provider_accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  provider TEXT NOT NULL DEFAULT 'E2PAY',
  environment TEXT NOT NULL CHECK (environment IN ('UAT','PRODUCTION')),
  account_scope TEXT NOT NULL DEFAULT 'SUB_ACCOUNT'
    CHECK (account_scope IN ('MASTER','SUB_ACCOUNT')),
  provider_account_id TEXT,
  provider_sub_account_id TEXT,
  account_name TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','INACTIVE')),
  balance REAL,
  available_balance REAL,
  last_balance_sync_at TEXT,
  metadata_json TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (account_scope='MASTER' AND client_id IS NULL)
    OR
    (account_scope='SUB_ACCOUNT' AND client_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_client_account
  ON payment_provider_accounts(org_id,client_id,provider,environment)
  WHERE account_scope='SUB_ACCOUNT';

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_external_subaccount
  ON payment_provider_accounts(provider,environment,provider_sub_account_id)
  WHERE provider_sub_account_id IS NOT NULL AND trim(provider_sub_account_id)<>'';

CREATE INDEX IF NOT EXISTS idx_provider_accounts_status
  ON payment_provider_accounts(org_id,provider,environment,status,client_id);

CREATE INDEX IF NOT EXISTS idx_provider_accounts_client
  ON payment_provider_accounts(client_id,provider,environment,status);
