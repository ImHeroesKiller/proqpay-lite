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

-- New ledger avoids adding uniqueness constraints to historical financial rows.
-- A caller owns a reference only when its generated token matches this row.
CREATE TABLE IF NOT EXISTS ar_payment_idempotency (
  ar_id TEXT NOT NULL REFERENCES ar_monitor(id),
  reference TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ar_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_unapplied_cash_ar_created
  ON unapplied_cash(ar_id, created_at DESC);
