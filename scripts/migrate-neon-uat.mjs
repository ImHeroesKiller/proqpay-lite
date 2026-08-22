import fs from 'node:fs';
import pg from 'pg';

const { Client } = pg;
const sourceUrl = String(process.env.PROQPAY_NEON_DATABASE_URL || '').trim();
const snapshotFile = String(process.env.PROQPAY_NEON_SNAPSHOT_FILE || '').trim();
const outputPath = process.argv[2] || '/tmp/proqpay-neon-uat.sql';
if (!snapshotFile && !sourceUrl.startsWith('postgres')) throw new Error('PROQPAY_NEON_DATABASE_URL is missing or invalid');

const allowedTables = [
  'organizations', 'clients', 'projects', 'branches', 'work_locations', 'employees',
  'employee_identity', 'employee_contracts', 'employee_assignments',
  'employee_compensation', 'employee_bank_accounts', 'employee_bpjs',
  'employee_education', 'employee_hris_meta',
];

function sqlValue(value) {
  if (value == null || value === '') return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  const normalized = value instanceof Date ? value.toISOString() :
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${normalized.replaceAll("'", "''").replaceAll('\u0000', '')}'`;
}

function insert(table, columns, values, conflict = 'DO NOTHING') {
  return `INSERT INTO ${table} (${columns.join(',')}) VALUES (${values.map(sqlValue).join(',')}) ON CONFLICT ${conflict};`;
}

function safeId(prefix, value) {
  const slug = String(value || 'X').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `${prefix}-${slug || 'X'}`;
}

function date(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function time(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

let snapshot;
if (snapshotFile) {
  const fixture = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  snapshot = Object.fromEntries(allowedTables.map((table) => [table, Array.isArray(fixture[table]) ? fixture[table] : []]));
} else {
  const client = new Client({ connectionString: sourceUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('BEGIN READ ONLY');
  try {
    const tableResult = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
    );
    const available = new Set(tableResult.rows.map((row) => row.table_name));
    snapshot = {};
    for (const table of allowedTables) {
      snapshot[table] = available.has(table) ? (await client.query(`SELECT * FROM ${table}`)).rows : [];
    }
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

const orgId = 'ORG-OTSINDO';
const migrationTime = new Date().toISOString();
// Wrangler/D1 manages remote file execution transactions internally and rejects
// explicit BEGIN/COMMIT statements.
const lines = ['PRAGMA foreign_keys = ON;'];
lines.push(insert('organizations', ['id', 'name', 'code'], [orgId, 'OTSINDO', 'OTSINDO'], '(id) DO UPDATE SET name=excluded.name'));

const clientIds = new Set();
for (const row of snapshot.clients) {
  const id = String(row.id || safeId('CLI', row.code || row.name));
  clientIds.add(id);
  lines.push(insert('clients', ['id','org_id','code','name','status','created_at'], [
    id, orgId, String(row.code || id).slice(0, 80), row.name || id, row.status || 'ACTIVE', time(row.created_at) || migrationTime,
  ], '(id) DO UPDATE SET name=excluded.name,status=excluded.status'));
}

const employees = snapshot.employees.filter((row) => row.id && row.name);
for (const row of employees) {
  const id = String(row.client_id || safeId('CLI', row.company || 'GENERAL'));
  if (!clientIds.has(id)) {
    clientIds.add(id);
    lines.push(insert('clients', ['id','org_id','code','name','status'], [id,orgId,id,row.company || 'General UAT','ACTIVE'], '(id) DO NOTHING'));
  }
}

const projectByClient = new Map();
for (const row of snapshot.projects) {
  if (!row.id || !clientIds.has(String(row.client_id))) continue;
  const clientId = String(row.client_id);
  projectByClient.set(clientId, String(row.id));
  lines.push(insert('projects', ['id','org_id','client_id','code','name','status','start_date','end_date','province','created_by'], [
    row.id,orgId,clientId,row.code || row.id,row.name || row.id,row.status || 'ACTIVE',date(row.start_date),date(row.end_date),row.province,'SYSTEM_NEON_UAT',
  ], '(id) DO UPDATE SET name=excluded.name,status=excluded.status'));
}
for (const clientId of clientIds) {
  if (projectByClient.has(clientId)) continue;
  const projectId = safeId('PRJ-UAT', clientId);
  projectByClient.set(clientId, projectId);
  lines.push(insert('projects', ['id','org_id','client_id','code','name','status','created_by'], [projectId,orgId,clientId,projectId,'UAT Migrasi Neon','ACTIVE','SYSTEM_NEON_UAT'], '(id) DO NOTHING'));
}

const branchIds = new Set(snapshot.branches.map((row) => String(row.id)).filter(Boolean));
for (const row of snapshot.branches) lines.push(insert('branches', ['id','org_id','name','city_umk','province','created_at'], [row.id,orgId,row.name || row.id,row.city_umk,row.province,time(row.created_at) || migrationTime], '(id) DO UPDATE SET name=excluded.name,city_umk=excluded.city_umk,province=excluded.province'));
const locationIds = new Set(snapshot.work_locations.map((row) => String(row.id)).filter(Boolean));
for (const row of snapshot.work_locations) {
  const branchId = row.branch_id && branchIds.has(String(row.branch_id)) ? row.branch_id : null;
  lines.push(insert('work_locations', ['id','branch_id','name','unit_kerja','province','city_umk','created_at'], [row.id,branchId,row.name || row.id,row.unit_kerja,row.province,row.city_umk,time(row.created_at) || migrationTime], '(id) DO UPDATE SET name=excluded.name,province=excluded.province,city_umk=excluded.city_umk'));
}

const employeeIds = new Set();
for (const row of employees) {
  const id = String(row.id), clientId = String(row.client_id || [...clientIds][0]);
  employeeIds.add(id);
  lines.push(insert('employees', ['id','org_id','client_id','project_id','branch_id','location_id','employee_code','name','gender','birth_place','birth_date','religion','phone','mobile','email','mother_name','status_aktif','province','created_at','updated_at'], [
    id,orgId,clientId,projectByClient.get(clientId),branchIds.has(String(row.branch_id))?row.branch_id:null,locationIds.has(String(row.location_id))?row.location_id:null,row.employee_code || id,row.name,row.gender,row.birth_place,date(row.birth_date),row.religion,row.phone,row.mobile,row.email,row.mother_name,row.status_aktif || 'ACTIVE',row.province,time(row.created_at) || migrationTime,time(row.updated_at) || migrationTime,
  ], '(id) DO UPDATE SET client_id=excluded.client_id,project_id=excluded.project_id,name=excluded.name,email=excluded.email,status_aktif=excluded.status_aktif,updated_at=excluded.updated_at'));
}

const related = [
  ['employee_identity',['employee_id','ktp_no','npwp_no','address','marital_status','ptkp_claimed','ptkp_updated']],
  ['employee_contracts',['id','employee_id','employment_type','contract_status','join_date','accepted_date','contract_start','contract_end','resign_date','resign_reason','candidate_source','is_current','created_at']],
  ['employee_assignments',['id','employee_id','position','pic','hrbp','effective_from','effective_to','is_current','created_at']],
  ['employee_bpjs',['employee_id','bpjs_kesehatan_no','bpjs_kesehatan_effective','jamsostek_no','updated_at']],
  ['employee_education',['id','employee_id','level','school_name','major','graduate_year','is_highest']],
  ['employee_hris_meta',['employee_id','input_user','input_at','fj_input_at','fj_input_user','es_input_at','es_input_user','hris_user']],
];
for (const [table, columns] of related) {
  for (const row of snapshot[table]) {
    if (!employeeIds.has(String(row.employee_id))) continue;
    const values = columns.map((column) => {
      if (column === 'id') return row.id || safeId(table.slice(0, 8), row.employee_id);
      if (column === 'created_at') return time(row[column]) || migrationTime;
      return column.includes('date') || column.endsWith('_at') || column.includes('effective') || column.includes('start') || column.includes('end') ? time(row[column]) : row[column];
    });
    lines.push(insert(table, columns, values, 'DO NOTHING'));
  }
}

for (const row of snapshot.employee_compensation) {
  if (!employeeIds.has(String(row.employee_id))) continue;
  lines.push(insert('employee_compensation', ['employee_id','basic_salary','salary_start','currency','payroll_source_period','imported_gross','imported_deduction','imported_net','payroll_components','updated_at'], [
    row.employee_id,Number(row.basic_salary||0),date(row.salary_start),row.currency||'IDR',null,0,0,0,row.payroll_components||{},time(row.updated_at) || migrationTime,
  ], '(employee_id) DO UPDATE SET basic_salary=excluded.basic_salary,salary_start=excluded.salary_start,currency=excluded.currency,updated_at=excluded.updated_at'));
}

const primarySeen = new Set();
const bankRows = [...snapshot.employee_bank_accounts].sort((a, b) =>
  Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || String(a.id || '').localeCompare(String(b.id || ''))
);
const bankEmployeeIds = [...new Set(bankRows.map((row) => String(row.employee_id || '')).filter((id) => employeeIds.has(id)))];
for (const employeeId of bankEmployeeIds) {
  lines.push(`UPDATE employee_bank_accounts SET is_primary=0 WHERE employee_id=${sqlValue(employeeId)};`);
}
for (const row of bankRows) {
  const employeeId = String(row.employee_id || '');
  if (!employeeIds.has(employeeId) || !row.account_no || !row.bank_name) continue;
  const primary = !primarySeen.has(employeeId) ? 1 : 0;
  primarySeen.add(employeeId);
  lines.push(insert('employee_bank_accounts', ['id','employee_id','bank_name','account_no','is_primary','created_at'], [row.id || safeId('BNK', employeeId),employeeId,row.bank_name,row.account_no,primary,time(row.created_at) || migrationTime], '(id) DO UPDATE SET bank_name=excluded.bank_name,account_no=excluded.account_no,is_primary=excluded.is_primary'));
}

lines.push(insert('audit_logs', ['id','org_id','username','role','action','detail','entity'], [
  `LOG-NEON-UAT-${Date.now()}`,orgId,'SYSTEM_NEON_UAT','SYSTEM','NEON_UAT_MIGRATION',`clients=${clientIds.size};employees=${employeeIds.size};banks=${primarySeen.size}`,'Migration',
]));
fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  sourceTables: Object.fromEntries(Object.entries(snapshot).map(([key, rows]) => [key, rows.length])),
  migration: { clients: clientIds.size, projects: projectByClient.size, employees: employeeIds.size, primaryBanks: primarySeen.size, statements: lines.length - 1 },
  outputPath,
}));
