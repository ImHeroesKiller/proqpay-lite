-- ProQPay Lite — HRIS / Payroll schema (Neon Postgres)
-- Normalized from "Data Karyawan Sample - IAP.xlsx"
-- Vendor (employer) ↔ Client ↔ Employee + related modules

BEGIN;

-- ── 1. Master: organisasi vendor (payroll provider) ───────────────
CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  code          TEXT UNIQUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Client (klien end-user, e.g. PT Indomarco) ─────────────────
CREATE TABLE IF NOT EXISTS clients (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id),
  code          TEXT NOT NULL,          -- Kode Klien e.g. 039
  name          TEXT NOT NULL,          -- PT. INDOMARCO ADI PRIMA
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, code)
);

-- ── 3. Cabang / area operasional ──────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id),
  name          TEXT NOT NULL,          -- MEDAN, DENPASAR, ...
  city_umk      TEXT,                   -- Kota UMK
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, name)
);

-- ── 4. Lokasi penempatan (unit site) ──────────────────────────────
CREATE TABLE IF NOT EXISTS work_locations (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT REFERENCES branches(id),
  name          TEXT NOT NULL,          -- KABANJAHE, TANJUNG BALAI, ...
  unit_kerja    TEXT,                   -- sering = nama client / OI
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Karyawan (inti) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,       -- NRK e.g. 039210588
  org_id        TEXT REFERENCES organizations(id),
  client_id     TEXT REFERENCES clients(id),
  branch_id     TEXT REFERENCES branches(id),
  location_id   TEXT REFERENCES work_locations(id),
  name          TEXT NOT NULL,
  gender        TEXT,                   -- Pria / Wanita
  birth_place   TEXT,
  birth_date    DATE,
  religion      TEXT,
  phone         TEXT,
  mobile        TEXT,
  email         TEXT,
  mother_name   TEXT,
  status_aktif  TEXT,                   -- Kontrak, Berhenti, Kontrak selesai, ...
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_client ON employees(client_id);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status_aktif);

-- ── 6. Identitas & alamat ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_identity (
  employee_id   TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  ktp_no        TEXT,
  npwp_no       TEXT,
  address       TEXT,
  marital_status TEXT,                  -- L/0, K/0, K/1, ...
  ptkp_claimed  TEXT,
  ptkp_updated  TEXT
);

-- ── 7. Kontrak & kepegawaian ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_contracts (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employment_type TEXT,                 -- Kontrak
  contract_status TEXT,                 -- PKWT
  join_date       DATE,                 -- Tanggal Join / Diterima
  accepted_date   DATE,
  contract_start  DATE,                 -- Awal Kontrak
  contract_end    DATE,                 -- Akhir Kontrak
  resign_date     DATE,                 -- Berhenti
  resign_reason   TEXT,                 -- Keterangan Berhenti
  candidate_source TEXT,                -- Kandidat dari Rekrutmen / Klien
  is_current      BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_emp ON employee_contracts(employee_id);

-- ── 8. Penempatan & jabatan ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_assignments (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  position      TEXT,                   -- DELIVERYMAN, PICKER PACKER, ...
  pic           TEXT,                   -- PIC cabang
  hrbp          TEXT,
  effective_from DATE,
  effective_to   DATE,
  is_current    BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 9. Kompensasi ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_compensation (
  employee_id   TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  basic_salary  BIGINT DEFAULT 0,       -- Gaji Pokok
  salary_start  DATE,                   -- TMT Gaji
  currency      TEXT DEFAULT 'IDR',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 10. Rekening bank ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_bank_accounts (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  bank_name     TEXT,                   -- MANDIRI, BSI, CIMB, ...
  account_no    TEXT,
  is_primary    BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 11. BPJS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_bpjs (
  employee_id       TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  bpjs_kesehatan_no TEXT,
  bpjs_kesehatan_effective DATE,
  jamsostek_no      TEXT,               -- BPJS TK / Jamsostek
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 12. Pendidikan ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_education (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  level         TEXT,                   -- SMA, SMK, ...
  school_name   TEXT,
  major         TEXT,                   -- Jurusan
  graduate_year INT,
  is_highest    BOOLEAN DEFAULT TRUE
);

-- ── 13. Audit input HRIS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_hris_meta (
  employee_id     TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  input_user      TEXT,
  input_at        DATE,
  fj_input_at     DATE,
  fj_input_user   TEXT,
  es_input_at     DATE,
  es_input_user   TEXT,
  hris_user       TEXT                  -- kolom User di sheet
);

-- ── 14. Payroll runtime (ProQPay existing domain) ─────────────────
CREATE TABLE IF NOT EXISTS payrolls (
  id              TEXT PRIMARY KEY,
  org_id          TEXT REFERENCES organizations(id),
  period          TEXT NOT NULL,        -- YYYY-MM
  status          TEXT DEFAULT 'DRAFT',
  total_gross     BIGINT DEFAULT 0,
  total_deduction BIGINT DEFAULT 0,
  total_net       BIGINT DEFAULT 0,
  employee_count  INT DEFAULT 0,
  details         JSONB DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, period)
);

CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id),
  client_id     TEXT REFERENCES clients(id),
  period        TEXT,
  amount        BIGINT DEFAULT 0,
  tax_amount    BIGINT DEFAULT 0,
  total_amount  BIGINT DEFAULT 0,
  status        TEXT DEFAULT 'DRAFT',
  issued_at     TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  items         JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  org_id        TEXT,
  timestamp     TIMESTAMPTZ DEFAULT NOW(),
  username      TEXT,
  role          TEXT,
  action        TEXT,
  detail        TEXT,
  entity        TEXT,
  entity_id     TEXT
);

COMMIT;
