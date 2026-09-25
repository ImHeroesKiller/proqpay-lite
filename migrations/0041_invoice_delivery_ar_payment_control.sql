PRAGMA foreign_keys = ON;

-- Invoice document delivery + AR payment control.
ALTER TABLE clients ADD COLUMN billing_cc_email TEXT;
ALTER TABLE clients ADD COLUMN ar_payment_block_mode TEXT NOT NULL DEFAULT 'OVERDUE'
  CHECK (ar_payment_block_mode IN ('OFF','OVERDUE','ANY_OUTSTANDING'));
ALTER TABLE clients ADD COLUMN ar_warning_days INTEGER NOT NULL DEFAULT 7
  CHECK (ar_warning_days BETWEEN 0 AND 90);

ALTER TABLE invoices ADD COLUMN document_snapshot TEXT
  CHECK (document_snapshot IS NULL OR json_valid(document_snapshot));
ALTER TABLE invoices ADD COLUMN pdf_r2_key TEXT;
ALTER TABLE invoices ADD COLUMN pdf_sha256 TEXT;
ALTER TABLE invoices ADD COLUMN pdf_generated_at TEXT;
ALTER TABLE invoices ADD COLUMN email_status TEXT NOT NULL DEFAULT 'NOT_SENT'
  CHECK (email_status IN ('NOT_SENT','SENDING','SENT','FAILED'));
ALTER TABLE invoices ADD COLUMN email_recipient TEXT;
ALTER TABLE invoices ADD COLUMN email_provider_id TEXT;
ALTER TABLE invoices ADD COLUMN email_sent_at TEXT;
ALTER TABLE invoices ADD COLUMN email_last_error TEXT;

CREATE TABLE IF NOT EXISTS billing_issuer_profiles (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  address TEXT,
  npwp TEXT,
  email TEXT,
  phone TEXT,
  bank_name TEXT,
  bank_account_name TEXT,
  bank_account_no TEXT,
  payment_notes TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_delivery_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL','DOWNLOAD','PDF_GENERATED')),
  recipient TEXT,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILED')),
  provider_message_id TEXT,
  pdf_sha256 TEXT,
  detail TEXT,
  actor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_delivery_invoice_created
  ON invoice_delivery_events(invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ar_monitor_client_balance_due
  ON ar_monitor(org_id, client_id, balance, due_date, status);

CREATE TRIGGER IF NOT EXISTS invoice_document_snapshot_immutable
BEFORE UPDATE OF document_snapshot ON invoices
WHEN OLD.document_snapshot IS NOT NULL
  AND NEW.document_snapshot IS NOT OLD.document_snapshot
BEGIN
  SELECT RAISE(ABORT, 'Invoice document snapshot is immutable');
END;
