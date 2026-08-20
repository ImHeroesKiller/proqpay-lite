PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  website TEXT,
  industry TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  npwp TEXT,
  nitku TEXT,
  billing_address TEXT,
  billing_email TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  tax_status TEXT NOT NULL DEFAULT 'NON_PKP',
  purchase_order TEXT,
  billing_method TEXT NOT NULL DEFAULT 'PER_EMPLOYEE',
  billing_rate REAL NOT NULL DEFAULT 0,
  billing_admin_fee INTEGER NOT NULL DEFAULT 0,
  billing_tax_rate REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, code)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  service_type TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  start_date TEXT,
  end_date TEXT,
  province TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, code)
);

CREATE TABLE provinces (code TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);

CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  city_umk TEXT,
  province TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, name)
);

CREATE TABLE work_locations (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id),
  name TEXT NOT NULL,
  unit_kerja TEXT,
  province TEXT,
  city_umk TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  branch_id TEXT REFERENCES branches(id),
  location_id TEXT REFERENCES work_locations(id),
  employee_code TEXT,
  name TEXT NOT NULL,
  gender TEXT,
  birth_place TEXT,
  birth_date TEXT,
  religion TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,
  mother_name TEXT,
  status_aktif TEXT,
  province TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_employee_code_org ON employees(org_id, employee_code)
  WHERE employee_code IS NOT NULL;
CREATE INDEX idx_employees_client_project ON employees(client_id, project_id);

CREATE TABLE employee_identity (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  ktp_no TEXT,
  npwp_no TEXT,
  address TEXT,
  marital_status TEXT,
  ptkp_claimed TEXT,
  ptkp_updated TEXT
);

CREATE TABLE employee_contracts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employment_type TEXT,
  contract_status TEXT,
  join_date TEXT,
  accepted_date TEXT,
  contract_start TEXT,
  contract_end TEXT,
  resign_date TEXT,
  resign_reason TEXT,
  candidate_source TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE employee_assignments (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  position TEXT,
  pic TEXT,
  hrbp TEXT,
  effective_from TEXT,
  effective_to TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE employee_compensation (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  basic_salary INTEGER NOT NULL DEFAULT 0,
  salary_start TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  payroll_source_period TEXT,
  imported_gross INTEGER NOT NULL DEFAULT 0,
  imported_deduction INTEGER NOT NULL DEFAULT 0,
  imported_net INTEGER NOT NULL DEFAULT 0,
  payroll_components TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payroll_components)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_compensation_period_employee
  ON employee_compensation(payroll_source_period, employee_id);

CREATE TABLE employee_bank_accounts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  account_no TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_one_primary_bank_per_employee
  ON employee_bank_accounts(employee_id) WHERE is_primary = 1;

CREATE TABLE employee_bpjs (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  bpjs_kesehatan_no TEXT,
  bpjs_kesehatan_effective TEXT,
  jamsostek_no TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE employee_education (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  level TEXT,
  school_name TEXT,
  major TEXT,
  graduate_year INTEGER,
  is_highest INTEGER NOT NULL DEFAULT 1 CHECK (is_highest IN (0, 1))
);

CREATE TABLE employee_hris_meta (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  input_user TEXT,
  input_at TEXT,
  fj_input_at TEXT,
  fj_input_user TEXT,
  es_input_at TEXT,
  es_input_user TEXT,
  hris_user TEXT
);

CREATE TABLE client_service_plans (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  contract_reference TEXT,
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_service_plans_effective
  ON client_service_plans(client_id, effective_from, effective_until);

CREATE TABLE payroll_submissions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  service_plan_id TEXT NOT NULL REFERENCES client_service_plans(id),
  service_tier TEXT NOT NULL,
  period TEXT NOT NULL,
  payment_period TEXT,
  arrears_periods TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(arrears_periods)),
  state TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT NOT NULL,
  processor_reviewed_at TEXT,
  processor_reviewed_by TEXT,
  processor_review_note TEXT,
  controller_reviewed_at TEXT,
  controller_reviewed_by TEXT,
  controller_review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_submissions_scope
  ON payroll_submissions(org_id, client_id, period, state);

CREATE TABLE submission_versions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES payroll_submissions(id),
  parent_version_id TEXT REFERENCES submission_versions(id),
  version_no INTEGER NOT NULL,
  source TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  checksum TEXT,
  dataset TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dataset)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (submission_id, version_no)
);

CREATE TABLE payroll_exceptions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES payroll_submissions(id),
  employee_id TEXT REFERENCES employees(id),
  field TEXT,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  source_value TEXT CHECK (source_value IS NULL OR json_valid(source_value)),
  canonical_value TEXT CHECK (canonical_value IS NULL OR json_valid(canonical_value)),
  suggested_value TEXT CHECK (suggested_value IS NULL OR json_valid(suggested_value)),
  reason TEXT,
  confidence REAL,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE INDEX idx_exceptions_queue
  ON payroll_exceptions(submission_id, status, severity);

CREATE TABLE billing_rules (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  service_plan_id TEXT NOT NULL REFERENCES client_service_plans(id),
  method TEXT NOT NULL,
  value REAL NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  version TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_billing_rules_effective
  ON billing_rules(client_id, service_plan_id, effective_from, effective_until);

-- payment_instructions is the only canonical payment source.
CREATE TABLE payment_instructions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  submission_id TEXT NOT NULL REFERENCES payroll_submissions(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  expected_total INTEGER NOT NULL CHECK (expected_total >= 0),
  creator_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  document_no TEXT,
  content_hash TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  execution_date TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_payment_instruction_document_no
  ON payment_instructions(org_id, document_no) WHERE document_no IS NOT NULL;
CREATE UNIQUE INDEX idx_payment_instruction_content_hash
  ON payment_instructions(org_id, content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX idx_payment_instructions_scope_created
  ON payment_instructions(org_id, client_id, created_at DESC);

CREATE TABLE payment_instruction_lines (
  id TEXT PRIMARY KEY,
  payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
  employee_id TEXT REFERENCES employees(id),
  beneficiary_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_code TEXT,
  masked_account TEXT NOT NULL,
  account_ciphertext TEXT NOT NULL,
  account_iv TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  line_hash TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0)
);

CREATE TRIGGER payment_instruction_lines_immutable_update
BEFORE UPDATE ON payment_instruction_lines
BEGIN
  SELECT RAISE(ABORT, 'Payment instruction snapshot is immutable');
END;

CREATE TRIGGER payment_instruction_lines_immutable_delete
BEFORE DELETE ON payment_instruction_lines
BEGIN
  SELECT RAISE(ABORT, 'Payment instruction snapshot is immutable');
END;

CREATE TABLE payment_approvals (
  id TEXT PRIMARY KEY,
  payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
  approver_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (payment_instruction_id, approver_user_id)
);

CREATE TABLE payment_proofs (
  id TEXT PRIMARY KEY,
  payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
  bank TEXT NOT NULL,
  reference TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  uploaded_file_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (payment_instruction_id, bank, reference)
);

CREATE INDEX idx_payment_proofs_instruction_created
  ON payment_proofs(payment_instruction_id, created_at DESC);

CREATE TABLE reconciliations (
  id TEXT PRIMARY KEY,
  payment_instruction_id TEXT NOT NULL UNIQUE REFERENCES payment_instructions(id),
  expected_total INTEGER NOT NULL,
  instruction_total INTEGER NOT NULL,
  proof_total INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  status TEXT NOT NULL,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  payment_instruction_id TEXT UNIQUE REFERENCES payment_instructions(id),
  invoice_number TEXT,
  company TEXT,
  period TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  due_date TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  approved_at TEXT,
  approved_by TEXT,
  created_by TEXT,
  sent_at TEXT,
  issued_at TEXT,
  paid_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  tax_invoice_status TEXT NOT NULL DEFAULT 'PENDING',
  tax_invoice_number TEXT,
  tax_invoice_date TEXT,
  coretax_reference TEXT,
  items TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(items))
);

CREATE UNIQUE INDEX idx_invoice_number_org
  ON invoices(org_id, invoice_number) WHERE invoice_number IS NOT NULL;

CREATE TABLE ar_monitor (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  company TEXT,
  invoice_id TEXT REFERENCES invoices(id),
  amount INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OUTSTANDING',
  due_date TEXT,
  days_overdue INTEGER NOT NULL DEFAULT 0,
  type TEXT,
  notes TEXT,
  last_follow_up_at TEXT,
  next_follow_up_at TEXT,
  dispute_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ar_payments (
  id TEXT PRIMARY KEY,
  ar_id TEXT NOT NULL REFERENCES ar_monitor(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_date TEXT NOT NULL,
  reference TEXT NOT NULL,
  notes TEXT,
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ar_follow_ups (
  id TEXT PRIMARY KEY,
  ar_id TEXT NOT NULL REFERENCES ar_monitor(id),
  note TEXT NOT NULL,
  next_follow_up_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  username TEXT,
  role TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  entity TEXT,
  entity_id TEXT
);

CREATE TABLE integration_connections (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  service_plan_id TEXT NOT NULL REFERENCES client_service_plans(id),
  connector_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INACTIVE',
  config TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE integration_sync_runs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES integration_connections(id),
  status TEXT NOT NULL,
  cursor TEXT,
  received_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE app_users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  payment_approver INTEGER NOT NULL DEFAULT 0 CHECK (payment_approver IN (0, 1)),
  created_by TEXT NOT NULL,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_client_scopes (
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE user_project_scopes (
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_app_sessions_user ON app_sessions(user_id);
CREATE INDEX idx_app_sessions_expiry ON app_sessions(expires_at);

CREATE TABLE ida_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ida_messages_session_created
  ON ida_messages(session_id, created_at DESC);

CREATE TABLE ida_memories (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  fact TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ida_memories_session_created
  ON ida_memories(session_id, created_at DESC);

INSERT INTO organizations (id, name, code)
VALUES ('ORG-OTSINDO', 'OTSINDO', 'OTSINDO');
