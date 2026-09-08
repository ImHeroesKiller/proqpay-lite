PRAGMA foreign_keys = ON;

-- Canonical partial-payment status used by Billing, AR, and Client visibility.
-- Historical rows from the older spelling are normalized forward-only.
UPDATE invoices
SET status='PARTIALLY_PAID',updated_at=datetime('now')
WHERE status='PARTIAL_PAID';

UPDATE ar_monitor
SET status='PARTIALLY_PAID',updated_at=datetime('now')
WHERE status='PARTIAL_PAID';
