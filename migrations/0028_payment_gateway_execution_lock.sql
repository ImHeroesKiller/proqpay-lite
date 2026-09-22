PRAGMA foreign_keys = ON;

-- Financial execution lease for provider calls.
-- It prevents two Workers/browser tabs from disbursing the same immutable PI
-- concurrently. A lease is short-lived so a crashed Worker cannot deadlock the PI.
ALTER TABLE payment_gateway_transactions ADD COLUMN execution_lock_token TEXT;
ALTER TABLE payment_gateway_transactions ADD COLUMN execution_lock_until TEXT;

CREATE INDEX IF NOT EXISTS idx_gateway_execution_lock
  ON payment_gateway_transactions(execution_lock_until)
  WHERE execution_lock_until IS NOT NULL;
