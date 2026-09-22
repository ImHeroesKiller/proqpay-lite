PRAGMA foreign_keys = ON;

-- Freeze commercial terms used for downstream invoicing at the canonical
-- Payment Instruction checkpoint. This prevents later client profile edits
-- from silently changing the amount that should be invoiced for a completed
-- payroll/payment.
ALTER TABLE payment_instructions ADD COLUMN billing_snapshot TEXT
  CHECK (billing_snapshot IS NULL OR json_valid(billing_snapshot));

ALTER TABLE invoices ADD COLUMN billing_snapshot TEXT
  CHECK (billing_snapshot IS NULL OR json_valid(billing_snapshot));
