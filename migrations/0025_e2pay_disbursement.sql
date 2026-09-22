PRAGMA foreign_keys = ON;

-- E2Pay executes one immutable Payment Instruction as many beneficiary-level
-- disbursements. The parent payment_gateway_transactions row remains the batch
-- orchestration record; this table makes each beneficiary independently
-- traceable and prevents whole-batch retries after partial success.
CREATE TABLE payment_gateway_items (
  id TEXT PRIMARY KEY,
  payment_gateway_transaction_id TEXT NOT NULL REFERENCES payment_gateway_transactions(id),
  payment_instruction_line_id TEXT NOT NULL REFERENCES payment_instruction_lines(id),
  employee_id TEXT,
  provider TEXT NOT NULL,
  client_ref TEXT NOT NULL,
  bank_id TEXT,
  beneficiary_name TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  fee_amount INTEGER NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  inquiry_id TEXT,
  provider_transaction_id TEXT,
  journal_id TEXT,
  correlation_id TEXT,
  response_code TEXT,
  response_message TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','INQUIRY_READY','PENDING','PROCESSING','SUCCEEDED','FAILED','UNKNOWN')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_checked_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (payment_gateway_transaction_id, payment_instruction_line_id),
  UNIQUE (provider, client_ref)
);

CREATE INDEX idx_gateway_items_batch_status
  ON payment_gateway_items(payment_gateway_transaction_id, status, created_at);
CREATE INDEX idx_gateway_items_provider_reference
  ON payment_gateway_items(provider, client_ref, journal_id);
