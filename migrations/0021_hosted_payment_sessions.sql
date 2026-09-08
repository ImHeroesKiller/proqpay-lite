PRAGMA foreign_keys = ON;

-- Hosted checkout sessions are browser-navigation artifacts only. They never
-- become proof of payment; signed gateway webhook events remain authoritative.
CREATE TABLE hosted_payment_sessions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
  payment_gateway_transaction_id TEXT REFERENCES payment_gateway_transactions(id),
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','READY','OPENED','RETURNED','EXPIRED','CANCELLED','FAILED','COMPLETED')),
  checkout_url TEXT,
  return_path TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  returned_at TEXT,
  completed_at TEXT,
  created_by TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_hosted_provider_session
  ON hosted_payment_sessions(provider, provider_session_id)
  WHERE provider_session_id IS NOT NULL;

CREATE UNIQUE INDEX idx_one_live_hosted_session_per_pi
  ON hosted_payment_sessions(payment_instruction_id)
  WHERE status IN ('CREATED','READY','OPENED','RETURNED');

CREATE INDEX idx_hosted_session_instruction_created
  ON hosted_payment_sessions(payment_instruction_id, created_at DESC);
CREATE INDEX idx_hosted_session_expiry
  ON hosted_payment_sessions(status, expires_at);
