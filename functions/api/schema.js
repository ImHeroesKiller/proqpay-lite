import { neon } from '@neondatabase/serverless';
import {
  authorize,
  enforceRateLimit,
  handlePreflight,
  publicError,
  secureJson,
} from './_security.js';

const METHODS = 'POST, OPTIONS';

function getUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env, METHODS);
  }

  if (request.method !== 'POST') {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: ['SUPER_ADMIN'],
    mutating: true,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;

  const rateLimited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    'schema-migration',
    METHODS
  );
  if (rateLimited) return rateLimited;

  const respond = (data, status = 200) =>
    secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  try {
    const url = getUrl(env);
    if (!url) return respond({ status: 'error', message: 'Service unavailable', requestId }, 503);

    const sql = neon(url);

    const statements = [
      `CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
        code TEXT NOT NULL, name TEXT NOT NULL, website TEXT, industry TEXT,
        contact_name TEXT, contact_email TEXT, contact_phone TEXT, logo_url TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (org_id, code))`,
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
        client_id TEXT NOT NULL REFERENCES clients(id), code TEXT NOT NULL, name TEXT NOT NULL,
        description TEXT, service_type TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', start_date DATE, end_date DATE, province TEXT,
        created_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, code))`,
      `CREATE TABLE IF NOT EXISTS provinces (
        code TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE)`,
      `CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
        name TEXT NOT NULL, city_umk TEXT, province TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (org_id, name))`,
      `CREATE TABLE IF NOT EXISTS work_locations (
        id TEXT PRIMARY KEY, branch_id TEXT REFERENCES branches(id),
        name TEXT NOT NULL, unit_kerja TEXT, province TEXT, city_umk TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
        client_id TEXT REFERENCES clients(id), branch_id TEXT REFERENCES branches(id),
        location_id TEXT REFERENCES work_locations(id), employee_code TEXT, name TEXT NOT NULL,
        gender TEXT, birth_place TEXT, birth_date DATE, religion TEXT,
        phone TEXT, mobile TEXT, email TEXT, mother_name TEXT, status_aktif TEXT,
        province TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS employee_identity (
        employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
        ktp_no TEXT, npwp_no TEXT, address TEXT,
        marital_status TEXT, ptkp_claimed TEXT, ptkp_updated TEXT)`,
      `CREATE TABLE IF NOT EXISTS employee_contracts (
        id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        employment_type TEXT, contract_status TEXT, join_date DATE, accepted_date DATE,
        contract_start DATE, contract_end DATE, resign_date DATE, resign_reason TEXT,
        candidate_source TEXT, is_current BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS employee_assignments (
        id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        position TEXT, pic TEXT, hrbp TEXT, effective_from DATE, effective_to DATE,
        is_current BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS employee_compensation (
        employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
        basic_salary BIGINT DEFAULT 0, salary_start DATE, currency TEXT DEFAULT 'IDR',
        updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS employee_bank_accounts (
        id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        bank_name TEXT, account_no TEXT, is_primary BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS employee_bpjs (
        employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
        bpjs_kesehatan_no TEXT, bpjs_kesehatan_effective DATE, jamsostek_no TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS employee_education (
        id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        level TEXT, school_name TEXT, major TEXT, graduate_year INT, is_highest BOOLEAN DEFAULT TRUE)`,
      `CREATE TABLE IF NOT EXISTS employee_hris_meta (
        employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
        input_user TEXT, input_at DATE, fj_input_at DATE, fj_input_user TEXT,
        es_input_at DATE, es_input_user TEXT, hris_user TEXT)`,
      `CREATE TABLE IF NOT EXISTS payrolls (
        id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id), period TEXT NOT NULL,
        status TEXT DEFAULT 'DRAFT', total_gross BIGINT DEFAULT 0, total_deduction BIGINT DEFAULT 0,
        total_net BIGINT DEFAULT 0, employee_count INT DEFAULT 0, details JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, period))`,
      `CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
        client_id TEXT REFERENCES clients(id), company TEXT, period TEXT, amount BIGINT DEFAULT 0,
        tax_amount BIGINT DEFAULT 0, total_amount BIGINT DEFAULT 0, status TEXT DEFAULT 'DRAFT',
        issued_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, items JSONB DEFAULT '[]'::jsonb)`,
      `CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
        payroll_id TEXT, period TEXT, approved_by TEXT, status TEXT DEFAULT 'PENDING',
        approved_at TIMESTAMPTZ)`,
      `CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
        payroll_id TEXT, period TEXT, bank TEXT, account TEXT, amount BIGINT DEFAULT 0,
        status TEXT DEFAULT 'DRAFT', reference TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), paid_at TIMESTAMPTZ)`,
      `CREATE TABLE IF NOT EXISTS ar_monitor (
        id TEXT PRIMARY KEY, org_id TEXT REFERENCES organizations(id),
        company TEXT, invoice_id TEXT, amount BIGINT DEFAULT 0,
        status TEXT DEFAULT 'OUTSTANDING', due_date TIMESTAMPTZ,
        days_overdue INT DEFAULT 0, type TEXT, notes TEXT)`,
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, org_id TEXT, timestamp TIMESTAMPTZ DEFAULT NOW(),
        username TEXT, role TEXT, action TEXT, detail TEXT, entity TEXT, entity_id TEXT)`,
      `CREATE TABLE IF NOT EXISTS client_service_plans (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), tier TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT', contract_reference TEXT, effective_from DATE NOT NULL,
        effective_until DATE, created_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS payroll_submissions (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), client_id TEXT NOT NULL REFERENCES clients(id),
        service_plan_id TEXT NOT NULL REFERENCES client_service_plans(id), service_tier TEXT NOT NULL,
        period TEXT NOT NULL, payment_period TEXT, arrears_periods JSONB NOT NULL DEFAULT '[]'::jsonb,
        state TEXT NOT NULL DEFAULT 'DRAFT', created_by TEXT NOT NULL,
        processor_reviewed_at TIMESTAMPTZ, processor_reviewed_by TEXT, processor_review_note TEXT,
        controller_reviewed_at TIMESTAMPTZ, controller_reviewed_by TEXT, controller_review_note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS submission_versions (
        id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES payroll_submissions(id),
        parent_version_id TEXT REFERENCES submission_versions(id), version_no INT NOT NULL,
        source TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT, checksum TEXT,
        dataset JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(submission_id, version_no))`,
      `CREATE TABLE IF NOT EXISTS payroll_exceptions (
        id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES payroll_submissions(id), payroll_id TEXT,
        employee_id TEXT REFERENCES employees(id), field TEXT, category TEXT NOT NULL, severity TEXT NOT NULL,
        source_value JSONB, canonical_value JSONB, suggested_value JSONB, reason TEXT, confidence NUMERIC(5,4),
        owner TEXT, status TEXT NOT NULL DEFAULT 'OPEN', resolution_note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ, resolved_by TEXT)`,
      `CREATE TABLE IF NOT EXISTS billing_rules (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), project_id TEXT,
        service_plan_id TEXT NOT NULL REFERENCES client_service_plans(id), method TEXT NOT NULL,
        value NUMERIC(18,4) NOT NULL, tax_rate NUMERIC(8,4) DEFAULT 0,
        effective_from DATE NOT NULL, effective_until DATE, version TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS payment_instructions (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), client_id TEXT NOT NULL REFERENCES clients(id),
        submission_id TEXT REFERENCES payroll_submissions(id), payroll_id TEXT, status TEXT NOT NULL DEFAULT 'DRAFT',
        expected_total BIGINT NOT NULL, creator_user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS payment_instruction_lines (
        id TEXT PRIMARY KEY, payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
        employee_id TEXT REFERENCES employees(id), beneficiary_name TEXT NOT NULL, bank_name TEXT NOT NULL,
        masked_account TEXT NOT NULL, amount BIGINT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS payment_approvals (
        id TEXT PRIMARY KEY, payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
        approver_user_id TEXT NOT NULL, status TEXT NOT NULL, action_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(payment_instruction_id, approver_user_id))`,
      `CREATE TABLE IF NOT EXISTS payment_proofs (
        id TEXT PRIMARY KEY, payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
        bank TEXT NOT NULL, reference TEXT NOT NULL, transaction_date DATE NOT NULL, amount BIGINT NOT NULL,
        uploaded_file_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS reconciliations (
        id TEXT PRIMARY KEY, payment_instruction_id TEXT NOT NULL REFERENCES payment_instructions(id),
        expected_total BIGINT NOT NULL, instruction_total BIGINT NOT NULL, proof_total BIGINT NOT NULL,
        difference BIGINT NOT NULL, status TEXT NOT NULL, reviewed_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS integration_connections (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), client_id TEXT NOT NULL REFERENCES clients(id),
        service_plan_id TEXT NOT NULL REFERENCES client_service_plans(id), connector_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'INACTIVE', config JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS integration_sync_runs (
        id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES integration_connections(id), status TEXT NOT NULL,
        cursor TEXT, received_count INT DEFAULT 0, error_summary TEXT,
        started_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ)`,
      `CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER')),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
        password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INT NOT NULL DEFAULT 100000,
        must_change_password BOOLEAN NOT NULL DEFAULT TRUE, payment_approver BOOLEAN NOT NULL DEFAULT FALSE,
        created_by TEXT NOT NULL, failed_login_attempts INT NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ,
        last_login_at TIMESTAMPTZ, password_changed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS user_client_scopes (
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (user_id, client_id))`,
      `CREATE TABLE IF NOT EXISTS user_project_scopes (
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (user_id, project_id))`,
      `CREATE TABLE IF NOT EXISTS app_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    ];

    for (const stmt of statements) {
      await sql.query(stmt);
    }

    const alters = [
      `ALTER TABLE branches ADD COLUMN IF NOT EXISTS province TEXT`,
      `ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS province TEXT`,
      `ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS city_umk TEXT`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS province TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_service_plans_effective ON client_service_plans(client_id, effective_from, effective_until)`,
      `CREATE INDEX IF NOT EXISTS idx_submissions_scope ON payroll_submissions(org_id, client_id, period, state)`,
      `CREATE INDEX IF NOT EXISTS idx_exceptions_queue ON payroll_exceptions(submission_id, status, severity)`,
      `CREATE INDEX IF NOT EXISTS idx_billing_rules_effective ON billing_rules(client_id, service_plan_id, effective_from, effective_until)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_lower ON app_users (LOWER(email))`,
      `CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_app_sessions_expiry ON app_sessions(expires_at)`,
      `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0`,
      `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`,
      `ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS payroll_source_period TEXT`,
      `ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS imported_gross BIGINT DEFAULT 0`,
      `ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS imported_deduction BIGINT DEFAULT 0`,
      `ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS imported_net BIGINT DEFAULT 0`,
      `ALTER TABLE employee_compensation ADD COLUMN IF NOT EXISTS payroll_components JSONB DEFAULT '{}'::jsonb`,
      `ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id)`,
      `ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS payment_period TEXT`,
      `ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS arrears_periods JSONB NOT NULL DEFAULT '[]'::jsonb`,
      `ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS processor_reviewed_at TIMESTAMPTZ`,
      `ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS processor_reviewed_by TEXT`,
      `ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS processor_review_note TEXT`,
      `ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS controller_reviewed_at TIMESTAMPTZ`,
      `ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS controller_reviewed_by TEXT`,
      `ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS controller_review_note TEXT`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id)`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_code TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_code_org ON employees(org_id, employee_code) WHERE employee_code IS NOT NULL`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS website TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_email TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_phone TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_url TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE'`,
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT`,
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_type TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS npwp TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS nitku TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_address TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_email TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_terms_days INT NOT NULL DEFAULT 30`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_status TEXT NOT NULL DEFAULT 'NON_PKP'`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS purchase_order TEXT`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_method TEXT NOT NULL DEFAULT 'PER_EMPLOYEE'`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_rate NUMERIC(18,4) NOT NULL DEFAULT 0`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_admin_fee BIGINT NOT NULL DEFAULT 0`,
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_tax_rate NUMERIC(8,4) NOT NULL DEFAULT 0`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id)`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_instruction_id TEXT REFERENCES payment_instructions(id)`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal BIGINT DEFAULT 0`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8,4) DEFAULT 0`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_by TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS review_note TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved_by TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_invoice_status TEXT DEFAULT 'PENDING'`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_invoice_number TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_invoice_date DATE`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS coretax_reference TEXT`,
      `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id)`,
      `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id)`,
      `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS paid_amount BIGINT DEFAULT 0`,
      `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS balance BIGINT DEFAULT 0`,
      `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ`,
      `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS next_follow_up_at DATE`,
      `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS dispute_reason TEXT`,
      `ALTER TABLE ar_monitor ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payment_instruction ON invoices(payment_instruction_id) WHERE payment_instruction_id IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_number_org ON invoices(org_id, invoice_number) WHERE invoice_number IS NOT NULL`,
    ];
    for (const a of alters) {
      try {
        await sql.query(a);
      } catch {
        /* ignore */
      }
    }

    await sql`
      INSERT INTO organizations (id, name, code)
      VALUES ('ORG-OTSINDO', 'OTSINDO', 'OTSINDO')
      ON CONFLICT (id) DO NOTHING
    `;
    return respond({
      status: 'ok',
      message: 'Schema ready — work_locations.province via IDA wilayah',
      host: 'cloudflare-pages',
      tables: [
        'organizations',
        'clients',
        'projects',
        'provinces',
        'branches',
        'work_locations',
        'employees',
        'employee_identity',
        'employee_contracts',
        'employee_assignments',
        'employee_compensation',
        'employee_bank_accounts',
        'employee_bpjs',
        'employee_education',
        'employee_hris_meta',
        'payrolls',
        'invoices',
        'approvals',
        'payments',
        'ar_monitor',
        'audit_logs',
        'client_service_plans',
        'payroll_submissions',
        'submission_versions',
        'payroll_exceptions',
        'billing_rules',
        'payment_instructions',
        'payment_instruction_lines',
        'payment_approvals',
        'payment_proofs',
        'reconciliations',
        'integration_connections',
        'integration_sync_runs',
        'app_users',
        'user_client_scopes',
        'user_project_scopes',
        'app_sessions',
      ],
    });
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
