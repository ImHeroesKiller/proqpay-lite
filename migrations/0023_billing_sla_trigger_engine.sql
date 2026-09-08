PRAGMA foreign_keys = ON;

-- Evidence-driven Billing/AR SLA policies. Existing invoices remain legacy and
-- keep their historical due dates; new policies are opt-in per client/project.
CREATE TABLE billing_sla_policies (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  terms_business_days INTEGER NOT NULL CHECK (terms_business_days BETWEEN 1 AND 365),
  required_triggers TEXT NOT NULL CHECK (json_valid(required_triggers)),
  calendar_mode TEXT NOT NULL DEFAULT 'WEEKDAYS_ONLY'
    CHECK (calendar_mode IN ('WEEKDAYS_ONLY','ID_OFFICIAL')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_billing_sla_policy_scope
  ON billing_sla_policies(org_id, client_id, project_id, status, effective_from DESC);

CREATE TABLE billing_sla_evidence (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  payment_instruction_id TEXT REFERENCES payment_instructions(id),
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('INVOICE_DOC_COMPLETE','BAST_SIGNED')),
  occurred_on TEXT NOT NULL,
  reference TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'RECORDED'
    CHECK (status IN ('RECORDED','VERIFIED','REJECTED')),
  recorded_by TEXT NOT NULL,
  verified_by TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_billing_sla_evidence_invoice
  ON billing_sla_evidence(invoice_id, trigger_type, status, created_at DESC);

CREATE TABLE business_calendar_years (
  country_code TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  status TEXT NOT NULL CHECK (status IN ('OFFICIAL','PROVISIONAL')),
  source_reference TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (country_code, year)
);

CREATE TABLE business_calendar_days (
  country_code TEXT NOT NULL,
  calendar_date TEXT NOT NULL,
  name TEXT NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN ('NATIONAL_HOLIDAY','COMPANY_HOLIDAY','COLLECTIVE_LEAVE')),
  is_business_day INTEGER NOT NULL DEFAULT 0 CHECK (is_business_day IN (0,1)),
  source_reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (country_code, calendar_date),
  FOREIGN KEY (country_code, substr(calendar_date,1,4)) REFERENCES business_calendar_years(country_code, year)
);

ALTER TABLE invoices ADD COLUMN sla_policy_id TEXT REFERENCES billing_sla_policies(id);
ALTER TABLE invoices ADD COLUMN sla_status TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK (sla_status IN ('LEGACY','WAITING_EVIDENCE','CALENDAR_INCOMPLETE','ACTIVE'));
ALTER TABLE invoices ADD COLUMN sla_triggered_at TEXT;
ALTER TABLE invoices ADD COLUMN sla_trigger_basis TEXT;

CREATE INDEX idx_invoices_sla_pending
  ON invoices(org_id, sla_status, status, updated_at DESC);

-- Official 2026 Indonesian national holidays from SKB 3 Menteri
-- No. 1497/2025, No. 2/2025, No. 5/2025. Cuti bersama is intentionally not
-- auto-excluded for private-company SLA because its private-sector adoption is
-- determined by each company's policy.
INSERT INTO business_calendar_years(country_code,year,status,source_reference)
VALUES ('ID',2026,'OFFICIAL','SKB 1497/2025; 2/2025; 5/2025')
ON CONFLICT(country_code,year) DO UPDATE SET
  status=excluded.status,source_reference=excluded.source_reference,updated_at=datetime('now');

INSERT OR REPLACE INTO business_calendar_days(country_code,calendar_date,name,day_type,is_business_day,source_reference) VALUES
('ID','2026-01-01','Tahun Baru 2026 Masehi','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-01-16','Isra Mikraj Nabi Muhammad saw.','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-02-17','Tahun Baru Imlek 2577 Kongzili','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-03-19','Hari Suci Nyepi Tahun Baru Saka 1948','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-03-21','Idulfitri 1447 H Hari Pertama','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-03-22','Idulfitri 1447 H Hari Kedua','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-04-03','Wafat Yesus Kristus','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-04-05','Kebangkitan Yesus Kristus','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-05-01','Hari Buruh Internasional','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-05-14','Kenaikan Yesus Kristus','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-05-27','Iduladha 1447 H','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-05-31','Hari Raya Waisak 2570 BE','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-06-01','Hari Lahir Pancasila','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-06-16','1 Muharam Tahun Baru Islam 1448 H','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-08-17','Proklamasi Kemerdekaan Republik Indonesia','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-08-25','Maulid Nabi Muhammad saw.','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025'),
('ID','2026-12-25','Kelahiran Yesus Kristus','NATIONAL_HOLIDAY',0,'SKB 1497/2025; 2/2025; 5/2025');
