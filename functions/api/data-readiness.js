import { d1All, d1First, hasD1 } from './_d1.js';
import { ROLES, authorize, clientIdsFor, projectIdsFor, handlePreflight, secureJson } from './_security.js';

const METHODS = 'GET, OPTIONS';
const ACTIVE_EMPLOYEE = `UPPER(TRIM(COALESCE(e.status_aktif,'ACTIVE'))) NOT IN
  ('INACTIVE','NONACTIVE','NON-ACTIVE','NON AKTIF','NONAKTIF','TIDAK AKTIF','RESIGN','RESIGNED',
   'TERMINATED','KELUAR','BERHENTI','PHK','PENSIUN','MENINGGAL','DECEASED','OFF','CANCELLED')`;

const CATEGORIES = {
  MISSING_PROJECT: { severity:'CRITICAL', title:'Karyawan belum memiliki project', field:'projectId', suggestion:'Tetapkan project aktif sebelum membuat Pay Run.' },
  MISSING_SALARY: { severity:'CRITICAL', title:'Gaji pokok belum tersedia', field:'salaryGross', suggestion:'Lengkapi kompensasi master atau upload payroll final.' },
  MISSING_BANK: { severity:'CRITICAL', title:'Rekening utama belum lengkap', field:'accountNo', suggestion:'Lengkapi bank dan nomor rekening utama.' },
  INVALID_NIK: { severity:'WARNING', title:'NIK belum valid', field:'nik', suggestion:'Periksa NIK 16 digit.' },
  MISSING_BPJS_KES: { severity:'WARNING', title:'BPJS Kesehatan belum tersedia', field:'bpjsKesehatanNo', suggestion:'Lengkapi nomor BPJS Kesehatan bila diwajibkan.' },
  MISSING_BPJS_TK: { severity:'WARNING', title:'BPJS Ketenagakerjaan belum tersedia', field:'jamsostekNo', suggestion:'Lengkapi nomor BPJS Ketenagakerjaan bila diwajibkan.' },
  EXPIRED_CONTRACT: { severity:'CRITICAL', title:'Kontrak berakhir tetapi karyawan masih aktif', field:'contractEnd', suggestion:'Periksa status aktif atau perpanjang kontrak sebelum payroll.' },
  PROJECT_CLIENT_MISMATCH: { severity:'CRITICAL', title:'Project tidak sesuai dengan klien karyawan', field:'projectId', suggestion:'Perbaiki assignment project agar berada pada klien yang sama.' },
  DUPLICATE_NIK: { severity:'CRITICAL', title:'NIK digunakan lebih dari satu karyawan', field:'nik', suggestion:'Tentukan record yang benar dan koreksi duplikasi sebelum payroll.' },
  SERVICE_TIER_MISSING: { severity:'CRITICAL', title:'Service tier tidak aktif untuk periode payroll', field:'servicePlan', suggestion:'Aktifkan service plan yang sesuai dengan project dan periode payroll.' },
};

function addIssue(groups, code, employee) {
  const definition = CATEGORIES[code];
  if (!groups.has(code)) groups.set(code, { code, ...definition, employeeIds:[], employees:[] });
  const group = groups.get(code);
  group.employeeIds.push(employee.id);
  if (group.employees.length < 20) group.employees.push({ id:employee.id, name:employee.name, clientId:employee.client_id, projectId:employee.project_id });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return secureJson({ error:'Method not allowed' }, 405, request, env, METHODS);

  const authorization = await authorize(request, env, { roles:ROLES, methods:METHODS });
  if (authorization.response) return authorization.response;
  const respond = (data,status=200)=>secureJson(data,status,request,env,METHODS);
  if (!hasD1(env)) return respond({ error:'Cloudflare D1 unavailable' },503);

  const actor = authorization.actor;
  const database = env.DB;
  const url = new URL(request.url);
  const requestedClientId = url.searchParams.get('clientId');
  const requestedProjectId = url.searchParams.get('projectId');
  const submissionId = url.searchParams.get('submissionId');
  let period = url.searchParams.get('period');
  let clientId = requestedClientId;
  let projectId = requestedProjectId;

  if (submissionId) {
    const submission = await d1First(database,'SELECT client_id,project_id,period FROM payroll_submissions WHERE id=? AND org_id=? LIMIT 1',[submissionId,String(env.DEFAULT_ORG_ID||'ORG-OTSINDO')]);
    if (!submission) return respond({ error:'Pay Run tidak ditemukan' },404);
    clientId = submission.client_id;
    projectId = submission.project_id;
    period = submission.period;
  }

  const scopedClients = clientIdsFor(actor,env);
  const scopedProjects = projectIdsFor(actor);
  if (actor.role === 'CLIENT_USER') {
    if (!clientId || !scopedClients?.includes(String(clientId))) return respond({ error:'Client scope denied' },403);
    if (scopedProjects?.length && (!projectId || !scopedProjects.includes(String(projectId)))) return respond({ error:'Project scope denied' },403);
  }

  const orgId = String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  const clauses = ['e.org_id=?'];
  const bindings = [orgId];
  if (clientId) { clauses.push('e.client_id=?'); bindings.push(clientId); }
  if (projectId) { clauses.push('e.project_id=?'); bindings.push(projectId); }
  if (actor.role === 'CLIENT_USER' && !clientId && scopedClients?.length) {
    clauses.push(`e.client_id IN (${scopedClients.map(()=>'?').join(',')})`); bindings.push(...scopedClients);
  }

  const employees = await d1All(database, `SELECT e.id,e.name,e.client_id,e.project_id,e.status_aktif,
      ec.basic_salary,ei.ktp_no,
      (SELECT bank_name FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS bank_name,
      (SELECT account_no FROM employee_bank_accounts WHERE employee_id=e.id AND is_primary=1 LIMIT 1) AS account_no,
      bp.bpjs_kesehatan_no,bp.jamsostek_no,
      (SELECT contract_end FROM employee_contracts WHERE employee_id=e.id AND is_current=1 ORDER BY created_at DESC LIMIT 1) AS contract_end,
      p.client_id AS project_client_id
    FROM employees e
    LEFT JOIN employee_compensation ec ON ec.employee_id=e.id
    LEFT JOIN employee_identity ei ON ei.employee_id=e.id
    LEFT JOIN employee_bpjs bp ON bp.employee_id=e.id
    LEFT JOIN projects p ON p.id=e.project_id
    WHERE ${clauses.join(' AND ')} AND ${ACTIVE_EMPLOYEE}
    ORDER BY e.name LIMIT 5000`, bindings);

  const groups = new Map();
  const nikMap = new Map();
  const now = Date.now();
  for (const employee of employees) {
    if (!employee.project_id) addIssue(groups,'MISSING_PROJECT',employee);
    if (Number(employee.basic_salary||0) <= 0) addIssue(groups,'MISSING_SALARY',employee);
    if (!String(employee.bank_name||'').trim() || !String(employee.account_no||'').trim()) addIssue(groups,'MISSING_BANK',employee);
    const nik = String(employee.ktp_no||'').replace(/\D/g,'');
    if (nik.length !== 16) addIssue(groups,'INVALID_NIK',employee);
    if (!String(employee.bpjs_kesehatan_no||'').trim()) addIssue(groups,'MISSING_BPJS_KES',employee);
    if (!String(employee.jamsostek_no||'').trim()) addIssue(groups,'MISSING_BPJS_TK',employee);
    if (employee.contract_end && Date.parse(employee.contract_end) < now) addIssue(groups,'EXPIRED_CONTRACT',employee);
    if (employee.project_id && employee.project_client_id && String(employee.project_client_id) !== String(employee.client_id)) addIssue(groups,'PROJECT_CLIENT_MISMATCH',employee);
    if (nik.length === 16) {
      if (!nikMap.has(nik)) nikMap.set(nik,[]);
      nikMap.get(nik).push(employee);
    }
  }
  for (const duplicates of nikMap.values()) if (duplicates.length > 1) duplicates.forEach((employee)=>addIssue(groups,'DUPLICATE_NIK',employee));

  if (clientId && period) {
    const start = `${period}-01`;
    const plan = await d1First(database, `SELECT sp.id FROM client_service_plans sp WHERE sp.client_id=? AND sp.status='ACTIVE'
      AND (sp.project_id IS NULL OR sp.project_id=?)
      AND sp.effective_from<date(?,'+1 month') AND (sp.effective_until IS NULL OR sp.effective_until>=?) LIMIT 1`,
      [clientId,projectId||null,start,start]);
    if (!plan) {
      const pseudo = { id:`SCOPE-${clientId}-${projectId||'ALL'}`, name:'Scope payroll', client_id:clientId, project_id:projectId };
      addIssue(groups,'SERVICE_TIER_MISSING',pseudo);
    }
  }

  const issues = [...groups.values()].map((group)=>({ ...group, count:group.employeeIds.length,
    action:{ label:'Lihat data terdampak', href:`/employees?readiness=${group.code}&ids=${encodeURIComponent(group.employeeIds.slice(0,100).join(','))}` } }));
  const critical = issues.filter((issue)=>issue.severity==='CRITICAL').reduce((sum,issue)=>sum+issue.count,0);
  const warning = issues.filter((issue)=>issue.severity==='WARNING').reduce((sum,issue)=>sum+issue.count,0);
  return respond({ ok:true, scope:{ clientId:clientId||null, projectId:projectId||null, submissionId:submissionId||null, period:period||null },
    summary:{ employees:employees.length, critical, warning, ready:critical===0 }, issues,
    answer:critical ? `Payroll belum siap. Ditemukan ${critical} blocker kritis pada ${issues.filter((issue)=>issue.severity==='CRITICAL').length} kategori.` : 'Data payroll siap diproses; tidak ada blocker kritis yang terdeteksi.' });
}
