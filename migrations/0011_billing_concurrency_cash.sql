PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS invoice_sequences (
  org_id TEXT NOT NULL,
  period TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, period)
);

CREATE TABLE IF NOT EXISTS unapplied_cash (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  ar_id TEXT REFERENCES ar_monitor(id),
  invoice_id TEXT REFERENCES invoices(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_date TEXT NOT NULL,
  reference TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPLIED','REFUNDED','VOID')),
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_payment_reference
  ON ar_payments(ar_id, reference);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unapplied_cash_reference
  ON unapplied_cash(ar_id, reference)
  WHERE status <> 'VOID';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_one_invoice
  ON ar_monitor(invoice_id)
  WHERE invoice_id IS NOT NULL;
