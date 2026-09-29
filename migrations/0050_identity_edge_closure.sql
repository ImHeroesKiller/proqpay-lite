PRAGMA foreign_keys = ON;

-- P2.1 Identity & Edge Closure
-- Phishing-resistant WebAuthn/passkeys for privileged roles.

ALTER TABLE app_sessions ADD COLUMN auth_strength TEXT NOT NULL DEFAULT 'PASSWORD'
  CHECK(auth_strength IN ('PASSWORD','PASSWORD_TOTP','PASSKEY_UV'));
ALTER TABLE app_sessions ADD COLUMN passkey_verified_at TEXT;

CREATE TABLE IF NOT EXISTS app_user_passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key_b64 TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0 CHECK(counter >= 0),
  transports_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(transports_json)),
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK(backed_up IN (0,1)),
  label TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_user_passkeys_user
  ON app_user_passkeys(user_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES app_users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('REGISTER','AUTHENTICATE')),
  challenge TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  expected_origin TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup
  ON webauthn_challenges(user_id,purpose,expires_at,consumed_at);

UPDATE app_sessions
SET auth_strength=CASE
  WHEN mfa_verified_at IS NOT NULL THEN 'PASSWORD_TOTP'
  ELSE 'PASSWORD'
END
WHERE auth_strength='PASSWORD';
