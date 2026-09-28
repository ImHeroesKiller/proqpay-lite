-- P0 E2Pay retry state-machine hardening.
-- Provider-verified retries are explicit states instead of overloading FAILED/error_code.
ALTER TABLE payment_gateway_items RENAME TO payment_gateway_items_legacy_retry_state;

CREATE TABLE payment_gateway_items (
  id TEXT PRIMARY KEY,
  payment_gateway_transaction_id TEXT NOT NULL REFERENCES payment_gateway_transactions(id),
  payment_instruction_line_id TEXT NOT NULL REFERENCES payment_instruction_lines(id),
  employee_id TEXT,
  provider TEXT NOT NULL,
  client_ref TEXT NOT NULL,
  bank_id TEXT,
  beneficiary_name TEXT NOT NULL,
  provider_beneficiary_name TEXT,
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
    CHECK (status IN (
      'CREATED','INQUIRY_READY',
      'RETRY_READY','RETRY_INQUIRY_READY',
      'PENDING','PROCESSING','SUCCEEDED','FAILED','UNKNOWN'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_checked_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (payment_gateway_transaction_id, payment_instruction_line_id),
  UNIQUE (provider, client_ref)
);

INSERT INTO payment_gateway_items (
  id,payment_gateway_transaction_id,payment_instruction_line_id,employee_id,provider,
  client_ref,bank_id,beneficiary_name,provider_beneficiary_name,account_last4,
  amount,fee_amount,inquiry_id,provider_transaction_id,journal_id,correlation_id,
  response_code,response_message,status,attempt_count,last_checked_at,error_code,error_message,
  created_at,updated_at
)
SELECT
  id,payment_gateway_transaction_id,payment_instruction_line_id,employee_id,provider,
  client_ref,bank_id,beneficiary_name,provider_beneficiary_name,account_last4,
  amount,fee_amount,inquiry_id,provider_transaction_id,journal_id,correlation_id,
  response_code,response_message,
  CASE
    WHEN status='FAILED' AND error_code='E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY' THEN 'RETRY_READY'
    ELSE status
  END,
  attempt_count,last_checked_at,
  CASE
    WHEN status='FAILED' AND error_code='E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY' THEN NULL
    ELSE error_code
  END,
  CASE
    WHEN status='FAILED' AND error_code='E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY' THEN NULL
    ELSE error_message
  END,
  created_at,updated_at
FROM payment_gateway_items_legacy_retry_state;

DROP TABLE payment_gateway_items_legacy_retry_state;

CREATE INDEX idx_gateway_items_batch_status
  ON payment_gateway_items(payment_gateway_transaction_id, status, created_at);
CREATE INDEX idx_gateway_items_provider_reference
  ON payment_gateway_items(provider, client_ref, journal_id);

-- Parent status remains FAILED until the Payroll Controller actively retries.
-- provider_status carries the explicit recoverable state without widening the
-- provider-neutral parent transaction CHECK constraint.
UPDATE payment_gateway_transactions
SET provider_status='RETRY_READY',
    error_code=NULL,
    error_message=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE provider='E2PAY'
  AND status='FAILED'
  AND EXISTS (
    SELECT 1 FROM payment_gateway_items pgi
    WHERE pgi.payment_gateway_transaction_id=payment_gateway_transactions.id
      AND pgi.status='RETRY_READY'
  )
  AND NOT EXISTS (
    SELECT 1 FROM payment_gateway_items pgi
    WHERE pgi.payment_gateway_transaction_id=payment_gateway_transactions.id
      AND pgi.status IN ('PENDING','PROCESSING','UNKNOWN')
  )
  AND NOT EXISTS (
    SELECT 1 FROM payment_gateway_items pgi
    WHERE pgi.payment_gateway_transaction_id=payment_gateway_transactions.id
      AND pgi.status='FAILED'
  );

