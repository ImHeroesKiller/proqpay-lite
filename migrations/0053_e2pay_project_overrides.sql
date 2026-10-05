PRAGMA foreign_keys = ON;

ALTER TABLE payment_provider_accounts ADD COLUMN project_id TEXT REFERENCES projects(id);

DROP INDEX IF EXISTS uq_provider_client_account;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_client_account
  ON payment_provider_accounts(org_id,client_id,provider,environment)
  WHERE account_scope='SUB_ACCOUNT' AND project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_project_account
  ON payment_provider_accounts(org_id,project_id,provider,environment)
  WHERE account_scope='SUB_ACCOUNT' AND project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_accounts_project
  ON payment_provider_accounts(project_id,provider,environment,status);
