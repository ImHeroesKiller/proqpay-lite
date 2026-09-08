PRAGMA foreign_keys = ON;

-- Provider-neutral execution ledger. Payment Instruction remains the canonical
-- source of beneficiaries, amount, approval and content hash.
CREATE TABLE payment_gateway_transactions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
  provider TEXT NOT NULL,
  provider_transaction_id TEXT,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','PENDING','PROCESSING','SUCCEEDED','FAILED','EXPIRED','CANCELLED')),
  provider_status TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  payment_method TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE UNIQUE INDEX idx_gateway_provider_transaction
  ON payment_gateway_transactions(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

-- Prevent a second live execution attempt for the same immutable PI while still
-- allowing a failed/expired/cancelled attempt to be retried using the same ledger.
CREATE UNIQUE INDEX idx_one_active_gateway_transaction
  ON payment_gateway_transactions(payment_instruction_id)
  WHERE status IN ('CREATED','PENDING','PROCESSING');

CREATE INDEX idx_gateway_instruction_created
  ON payment_gateway_transactions(payment_instruction_id, created_at DESC);
CREATE INDEX idx_gateway_scope_created
  ON payment_gateway_transactions(org_id, client_id, created_at DESC);

-- Raw webhook events are retained for idempotency and audit. No secrets or full
-- beneficiary account numbers may be persisted in payload_json.
CREATE TABLE payment_gateway_events (
  id TEXT PRIMARY KEY,
  payment_gateway_transaction_id TEXT REFERENCES payment_gateway_transactions(id),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  signature_valid INTEGER NOT NULL DEFAULT 0 CHECK (signature_valid IN (0,1)),
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED','PROCESSED','IGNORED','FAILED')),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_gateway_events_transaction_received
  ON payment_gateway_events(payment_gateway_transaction_id, received_at DESC);
