-- P1 E2Pay execution observability.
-- Stores only sanitized diagnostics; no password, token, account number, or raw sourceId is persisted.
ALTER TABLE payment_gateway_items ADD COLUMN provider_http_status INTEGER;
ALTER TABLE payment_gateway_items ADD COLUMN failure_stage TEXT;
ALTER TABLE payment_gateway_items ADD COLUMN request_diagnostics_json TEXT;
ALTER TABLE payment_gateway_items ADD COLUMN last_attempt_at TEXT;

CREATE INDEX IF NOT EXISTS idx_gateway_items_failure_stage
  ON payment_gateway_items(payment_gateway_transaction_id, failure_stage, status);
