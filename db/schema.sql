-- ProQPay Lite — HRIS / Payroll schema (Neon Postgres)
-- work_locations mengikuti Provinsi (diidentifikasi IDA/wilayah resolver)

BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, code)
);

-- Master provinsi (opsional, untuk FK soft)
CREATE TABLE IF NOT EXISTS provinces (
  code TEXT PRIMARY KEY,              -- e.g. 11, 31, 51
  name TEXT NOT NULL UNIQUE           -- Aceh, DKI Jakarta, Bali
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  name TEXT NOT NULL,
  city_umk TEXT,
  province TEXT,                      -- diisi IDA identifyProvince(cabang, kota_umk)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS work_locations (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id),
  name TEXT NOT NULL,                 -- lokasi penempatan
  unit_kerja TEXT,
  province TEXT NOT NULL,             -- WAJIB: provinsi hasil identifikasi IDA
  city_umk TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_locations_province ON work_locations(province);
CREATE INDEX IF NOT EXISTS idx_branches_province ON branches(province);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  branch_id TEXT REFERENCES branches(id),
  location_id TEXT REFERENCES work_locations(id),
  name TEXT NOT NULL,
  gender TEXT,
  birth_place TEXT,
  birth_date DATE,
  religion TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,
  mother_name TEXT,
  status_aktif TEXT,
  province TEXT,                      -- denormalized dari work_location untuk query cepat
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_client ON employees(client_id);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status_aktif);
CREATE INDEX IF NOT EXISTS idx_employees_province ON employees(province);

CREATE TABLE IF NOT EXISTS employee_identity (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  ktp_no TEXT,
  npwp_no TEXT,
  address TEXT,
  marital_status TEXT,
  ptkp_claimed TEXT,
  ptkp_updated TEXT
);

CREATE TABLE IF NOT EXISTS employee_contracts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employment_type TEXT,
  contract_status TEXT,
  join_date DATE,
  accepted_date DATE,
  contract_start DATE,
  contract_end DATE,
  resign_date DATE,
  resign_reason TEXT,
  candidate_source TEXT,
  is_current BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_assignments (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  position TEXT,
  pic TEXT,
  hrbp TEXT,
  effective_from DATE,
  effective_to DATE,
  is_current BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_compensation (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  basic_salary BIGINT DEFAULT 0,
  salary_start DATE,
  currency TEXT DEFAULT 'IDR',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_bank_accounts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  bank_name TEXT,
  account_no TEXT,
  is_primary BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_bpjs (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  bpjs_kesehatan_no TEXT,
  bpjs_kesehatan_effective DATE,
  jamsostek_no TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_education (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  level TEXT,
  school_name TEXT,
  major TEXT,
  graduate_year INT,
  is_highest BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS employee_hris_meta (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  input_user TEXT,
  input_at DATE,
  fj_input_at DATE,
  fj_input_user TEXT,
  es_input_at DATE,
  es_input_user TEXT,
  hris_user TEXT
);

CREATE TABLE IF NOT EXISTS payrolls (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  period TEXT NOT NULL,
  status TEXT DEFAULT 'DRAFT',
  total_gross BIGINT DEFAULT 0,
  total_deduction BIGINT DEFAULT 0,
  total_net BIGINT DEFAULT 0,
  employee_count INT DEFAULT 0,
  details JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, period)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  client_id TEXT REFERENCES clients(id),
  period TEXT,
  amount BIGINT DEFAULT 0,
  tax_amount BIGINT DEFAULT 0,
  total_amount BIGINT DEFAULT 0,
  status TEXT DEFAULT 'DRAFT',
  issued_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  items JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  username TEXT,
  role TEXT,
  action TEXT,
  detail TEXT,
  entity TEXT,
  entity_id TEXT
);

COMMIT;

-- The managed payroll operating model is additive and maintained in:
-- db/migrations/001_managed_payroll_operating_model.sql
