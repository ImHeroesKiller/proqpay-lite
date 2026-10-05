PRAGMA foreign_keys = ON;

ALTER TABLE payment_provider_accounts ADD COLUMN provisioning_state TEXT NOT NULL DEFAULT 'NOT_STARTED'
  CHECK (provisioning_state IN ('NOT_STARTED','PENDING_CONFIRMATION','PROVISIONED','FAILED','SUSPENDED'));
ALTER TABLE payment_provider_accounts ADD COLUMN provisioning_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_provider_accounts ADD COLUMN last_provisioning_attempt_at TEXT;
ALTER TABLE payment_provider_accounts ADD COLUMN last_provisioning_error_code TEXT;
ALTER TABLE payment_provider_accounts ADD COLUMN last_provisioning_error_message TEXT;

UPDATE payment_provider_accounts
SET provisioning_state=CASE
  WHEN status='ACTIVE' AND provider_sub_account_id IS NOT NULL THEN 'PROVISIONED'
  WHEN status='INACTIVE' THEN 'SUSPENDED'
  ELSE 'NOT_STARTED'
END
WHERE provider='E2PAY';

CREATE INDEX IF NOT EXISTS idx_provider_accounts_provisioning
  ON payment_provider_accounts(org_id,provider,environment,provisioning_state,client_id,project_id);
