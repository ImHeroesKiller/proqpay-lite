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
        code TEXT NOT NULL, name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (org_id, code))`,
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
        location_id TEXT REFERENCES work_locations(id), name TEXT NOT NULL,
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
        client_id TEXT REFERENCES clients(id), period TEXT, amount BIGINT DEFAULT 0,
        tax_amount BIGINT DEFAULT 0, total_amount BIGINT DEFAULT 0, status TEXT DEFAULT 'DRAFT',
        issued_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, items JSONB DEFAULT '[]'::jsonb)`,
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, org_id TEXT, timestamp TIMESTAMPTZ DEFAULT NOW(),
        username TEXT, role TEXT, action TEXT, detail TEXT, entity TEXT, entity_id TEXT)`,
    ];

    for (const stmt of statements) {
      await sql.query(stmt);
    }

    const alters = [
      `ALTER TABLE branches ADD COLUMN IF NOT EXISTS province TEXT`,
      `ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS province TEXT`,
      `ALTER TABLE work_locations ADD COLUMN IF NOT EXISTS city_umk TEXT`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS province TEXT`,
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
    await sql`
      INSERT INTO clients (id, org_id, code, name)
      VALUES ('CLI-039', 'ORG-OTSINDO', '039', 'PT. INDOMARCO ADI PRIMA')
      ON CONFLICT (id) DO NOTHING
    `;

    return respond({
      status: 'ok',
      message: 'Schema ready — work_locations.province via IDA wilayah',
      host: 'cloudflare-pages',
      tables: [
        'organizations',
        'clients',
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
        'audit_logs',
      ],
    });
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
