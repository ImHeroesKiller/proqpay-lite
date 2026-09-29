PRAGMA foreign_keys = OFF;

-- P1 Security Governance & Operational Readiness
-- Forward-only repair for Billing SLA parent schema plus fraud incident lifecycle.

CREATE TABLE IF NOT EXISTS billing_sla_policies (
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

CREATE INDEX IF NOT EXISTS idx_billing_sla_policy_scope
  ON billing_sla_policies(org_id, client_id, project_id, status, effective_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_client_sla_policy
  ON billing_sla_policies(org_id, client_id)
  WHERE status='ACTIVE' AND project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_project_sla_policy
  ON billing_sla_policies(org_id, client_id, project_id)
  WHERE status='ACTIVE' AND project_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS billing_sla_policy_triggers_array_insert
BEFORE INSERT ON billing_sla_policies
WHEN json_type(NEW.required_triggers) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'billing_sla_policies.required_triggers must be a JSON array');
END;

CREATE TRIGGER IF NOT EXISTS billing_sla_policy_triggers_array_update
BEFORE UPDATE OF required_triggers ON billing_sla_policies
WHEN json_type(NEW.required_triggers) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'billing_sla_policies.required_triggers must be a JSON array');
END;

CREATE TABLE IF NOT EXISTS fraud_incidents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  incident_key TEXT NOT NULL,
  source TEXT NOT NULL,
  rule_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK(status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED','RESOLVED','FALSE_POSITIVE')),
  entity TEXT,
  entity_id TEXT,
  actor_user_id TEXT,
  actor_ip_hash TEXT,
  actor_device_hash TEXT,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK(occurrence_count >= 1),
  assigned_to TEXT,
  due_at TEXT,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  escalated_by TEXT,
  escalated_at TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_fraud_incidents_queue
  ON fraud_incidents(org_id,status,severity,due_at,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_incidents_rule
  ON fraud_incidents(org_id,rule_code,last_seen_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_incidents_open_key
  ON fraud_incidents(org_id,incident_key)
  WHERE status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED');

PRAGMA foreign_keys = ON;
