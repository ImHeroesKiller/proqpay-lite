PRAGMA foreign_keys = ON;

-- Super Admin managed payment-gateway configuration.
-- Provider/environment are operational metadata. Provider credentials are
-- encrypted as one AES-GCM JSON document and are never returned in plaintext.
CREATE TABLE gateway_secure_settings (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id),
  provider TEXT NOT NULL DEFAULT 'UNCONFIGURED'
    CHECK (provider IN ('UNCONFIGURED','E2PAY')),
  environment TEXT NOT NULL DEFAULT 'UAT'
    CHECK (environment IN ('UAT','PRODUCTION')),
  credentials_ciphertext TEXT,
  credentials_iv TEXT,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_gateway_secure_provider
  ON gateway_secure_settings(provider, environment);
