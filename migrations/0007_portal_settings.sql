PRAGMA foreign_keys = ON;

-- ESS presentation settings. Additive: does not alter payroll, PI, billing, or EWA request rows.

CREATE TABLE portal_settings (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  copy_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(copy_json)),
  features_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(features_json)),
  ads_platform_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ads_platform_json)),
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_portal_settings_scope
  ON portal_settings(org_id, COALESCE(client_id, ''));

CREATE TABLE portal_ads (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  placement TEXT NOT NULL DEFAULT 'HOME' CHECK (placement IN ('HOME','EWA','PAYSLIP')),
  provider TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (provider IN ('INTERNAL','EXTERNAL','PIXEL')),
  action TEXT NOT NULL DEFAULT 'EWA' CHECK (action IN ('NONE','EWA','PAYSLIP','EXTERNAL')),
  tag TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  href TEXT,
  bg TEXT,
  image_url TEXT,
  impression_url TEXT,
  click_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_portal_ads_scope
  ON portal_ads(org_id, COALESCE(client_id, ''), enabled, sort_order);
