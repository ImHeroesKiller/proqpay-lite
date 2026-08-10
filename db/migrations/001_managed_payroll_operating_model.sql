-- Additive migration. No existing table or column is dropped or renamed.
BEGIN;

CREATE TABLE IF NOT EXISTS client_service_plans (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT', contract_reference TEXT,
  effective_from DATE NOT NULL, effective_until DATE, created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (tier IN ('TIER_1_PAYMENT_PROCESSING','TIER_2_MANAGED_PAYROLL','TIER_3_INTEGRATED_AUTOMATION'))
);
CREATE INDEX IF NOT EXISTS idx_service_plans_effective ON client_service_plans(client_id, effective_from, effective_until);

CREATE TABLE IF NOT EXISTS payroll_submissions (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), client_id TEXT NOT NULL REFERENCES clients(id),
  service_plan_id TEXT NOT NULL REFERENCES client_service_plans(id), service_tier TEXT NOT NULL,
  period TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'DRAFT', created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_submissions_scope ON payroll_submissions(org_id, client_id, period, state);

CREATE TABLE IF NOT EXISTS submission_versions (
  id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES payroll_submissions(id), parent_version_id TEXT REFERENCES submission_versions(id),
  version_no INT NOT NULL, source TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT, checksum TEXT,
  dataset JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(submission_id, version_no)
);

CREATE TABLE IF NOT EXISTS payroll_exceptions (
  id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES payroll_submissions(id), payroll_id TEXT,
  employee_id TEXT REFERENCES employees(id), field TEXT, category TEXT NOT NULL, severity TEXT NOT NULL,
  source_value JSONB, canonical_value JSONB, suggested_value JSONB, reason TEXT, confidence NUMERIC(5,4),
  owner TEXT, status TEXT NOT NULL DEFAULT 'OPEN', resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ, resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_exceptions_queue ON payroll_exceptions(submission_id, status, severity);

CREATE TABLE IF NOT EXISTS billing_rules (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), project_id TEXT,
  service_plan_id TEXT NOT NULL REFERENCES client_service_plans(id), method TEXT NOT NULL,
  value NUMERIC(18,4) NOT NULL, tax_rate NUMERIC(8,4) DEFAULT 0,
  effective_from DATE NOT NULL, effective_until DATE, version TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_rules_effective ON billing_rules(client_id, service_plan_id, effective_from, effective_until);

CREATE TABLE IF NOT EXISTS payment_instructions (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), client_id TEXT NOT NULL REFERENCES clients(id),
  submission_id TEXT REFERENCES payroll_submissions(id), payroll_id TEXT, status TEXT NOT NULL DEFAULT 'DRAFT',
  expected_total BIGINT NOT NULL, creator_user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS payment_instruction_lines (
  id TEXT PRIMARY KEY, payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id), employee_id TEXT REFERENCES employees(id),
  beneficiary_name TEXT NOT NULL, bank_name TEXT NOT NULL, masked_account TEXT NOT NULL, amount BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_approvals (
  id TEXT PRIMARY KEY, payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
  approver_user_id TEXT NOT NULL, status TEXT NOT NULL, action_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(payment_instruction_id, approver_user_id),
  CHECK (status IN ('APPROVED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS payment_proofs (
  id TEXT PRIMARY KEY, payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id), bank TEXT NOT NULL,
  reference TEXT NOT NULL, transaction_date DATE NOT NULL, amount BIGINT NOT NULL,
  uploaded_file_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reconciliations (
  id TEXT PRIMARY KEY, payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
  expected_total BIGINT NOT NULL, instruction_total BIGINT NOT NULL, proof_total BIGINT NOT NULL,
  difference BIGINT NOT NULL, status TEXT NOT NULL, reviewed_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), client_id TEXT NOT NULL REFERENCES clients(id),
  service_plan_id TEXT NOT NULL REFERENCES client_service_plans(id), connector_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INACTIVE', config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS integration_sync_runs (
  id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES integration_connections(id), status TEXT NOT NULL,
  cursor TEXT, received_count INT DEFAULT 0, error_summary TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
);

COMMIT;
