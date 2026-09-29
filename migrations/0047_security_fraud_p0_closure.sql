PRAGMA foreign_keys = ON;

-- P0 Security & Fraud Questionnaire Closure
-- MFA, session context, encrypted employee-bank metadata, fraud controls,
-- payment limits, and payment security evidence.

ALTER TABLE app_users ADD COLUMN mfa_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_sessions ADD COLUMN mfa_verified_at TEXT;
ALTER TABLE app_sessions ADD COLUMN ip_hash TEXT;
ALTER TABLE app_sessions ADD COLUMN device_hash TEXT;

CREATE TABLE IF NOT EXISTS app_user_mfa (
  user_id TEXT PRIMARY KEY,
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','DISABLED')),
  enrolled_at TEXT,
  activated_at TEXT,
  last_verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

UPDATE app_users
SET mfa_required=1
WHERE role IN ('SUPER_ADMIN','PAYROLL_CONTROLLER');

ALTER TABLE employee_bank_accounts ADD COLUMN account_ciphertext TEXT;
ALTER TABLE employee_bank_accounts ADD COLUMN account_iv TEXT;
ALTER TABLE employee_bank_accounts ADD COLUMN account_last4 TEXT;
ALTER TABLE employee_bank_accounts ADD COLUMN account_fingerprint TEXT;
ALTER TABLE employee_bank_accounts ADD COLUMN encrypted_at TEXT;

UPDATE employee_bank_accounts
SET account_last4=substr(replace(account_no,' ',''),-4)
WHERE account_last4 IS NULL AND account_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS fraud_blocklist (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  block_type TEXT NOT NULL CHECK(block_type IN ('USER_ID','EMAIL','IP','DEVICE','BANK_ACCOUNT')),
  value_hash TEXT NOT NULL,
  value_last4 TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
  expires_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_by TEXT,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_blocklist_active_value
  ON fraud_blocklist(org_id,block_type,value_hash)
  WHERE status='ACTIVE';

CREATE INDEX IF NOT EXISTS idx_fraud_blocklist_expiry
  ON fraud_blocklist(org_id,status,expires_at);

CREATE TABLE IF NOT EXISTS payment_security_limits (
  org_id TEXT PRIMARY KEY,
  max_single_amount INTEGER NOT NULL DEFAULT 10000000000,
  max_daily_amount INTEGER NOT NULL DEFAULT 25000000000,
  max_daily_executions INTEGER NOT NULL DEFAULT 50,
  max_recipients INTEGER NOT NULL DEFAULT 5000,
  step_up_window_seconds INTEGER NOT NULL DEFAULT 600,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE payment_gateway_transactions ADD COLUMN actor_user_id TEXT;
ALTER TABLE payment_gateway_transactions ADD COLUMN actor_ip_hash TEXT;
ALTER TABLE payment_gateway_transactions ADD COLUMN actor_device_hash TEXT;
ALTER TABLE payment_gateway_transactions ADD COLUMN mfa_verified_at TEXT;
ALTER TABLE payment_gateway_transactions ADD COLUMN risk_decision_json TEXT;

ALTER TABLE payment_approvals ADD COLUMN ip_hash TEXT;
ALTER TABLE payment_approvals ADD COLUMN device_hash TEXT;
ALTER TABLE payment_approvals ADD COLUMN mfa_verified_at TEXT;

ALTER TABLE audit_logs ADD COLUMN ip_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN device_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN security_context_json TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_gateway_daily_security
  ON payment_gateway_transactions(org_id,created_at,status);

CREATE INDEX IF NOT EXISTS idx_payment_approvals_mfa
  ON payment_approvals(payment_instruction_id,mfa_verified_at);
