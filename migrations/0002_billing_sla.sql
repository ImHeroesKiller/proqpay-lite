ALTER TABLE clients ADD COLUMN payment_terms_basis TEXT NOT NULL DEFAULT 'CALENDAR_DAYS'
  CHECK (payment_terms_basis IN ('CALENDAR_DAYS','BUSINESS_DAYS'));
ALTER TABLE clients ADD COLUMN sla_trigger TEXT NOT NULL DEFAULT 'INVOICE_ISSUED'
  CHECK (sla_trigger IN ('PAYROLL_PAID','INVOICE_ISSUED','COMPLETE_DOCUMENT_RECEIVED','RECEIPT_ACKNOWLEDGED','BAST_SIGNED','CUSTOM'));
ALTER TABLE clients ADD COLUMN sla_trigger_label TEXT;
ALTER TABLE clients ADD COLUMN sla_required_documents TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sla_required_documents));

ALTER TABLE invoices ADD COLUMN sla_trigger TEXT;
ALTER TABLE invoices ADD COLUMN sla_trigger_date TEXT;
ALTER TABLE invoices ADD COLUMN sla_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
  CHECK (sla_status IN ('NOT_STARTED','RUNNING','COMPLETED'));
ALTER TABLE invoices ADD COLUMN sla_evidence_notes TEXT;

CREATE TABLE business_holidays (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  holiday_date TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, holiday_date)
);

CREATE INDEX idx_business_holidays_org_date ON business_holidays(org_id, holiday_date);
