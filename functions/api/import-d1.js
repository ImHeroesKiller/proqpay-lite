import { d1All, d1Batch, d1First } from './_d1.js';
import { clientIdsFor, projectIdsFor, publicError } from './_security.js';

const MAX_BINDINGS=90;
function slug(value) { return String(value||'X').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40); }
function chunks(values,size) { const result=[]; for(let i=0;i<values.length;i+=size) result.push(values.slice(i,i+size)); return result; }
function bulk(table,columns,rows,conflict='') {
  if (!rows.length) return [];
  const size=Math.max(1,Math.floor(MAX_BINDINGS/columns.length));
  return chunks(rows,size).map((group)=>({
    statement:`INSERT INTO ${table} (${columns.join(',')}) VALUES ${group.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',')} ${conflict}`,
    bindings:group.flat(),
  }));
}
function unique(rows,key) { const map=new Map(); for(const row of rows) map.set(key(row),row); return [...map.values()]; }

export async function importRowsD1({env,actor,body,rows,respond,requestId}) {
  const database=env.DB,organizationId=String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  const context=body.context&&typeof body.context==='object'?body.context:null;
  const clientId=context?.clientId?String(context.clientId):null,servicePlanId=context?.servicePlanId?String(context.servicePlanId):null,
    serviceTier=context?.tier?String(context.tier):null,projectId=context?.projectId?String(context.projectId):null,
    period=/^\d{4}-(0[1-9]|1[0-2])$/.test(String(context?.period||''))?String(context.period):new Date().toISOString().slice(0,7);
  const rowClientId=(row)=>clientId||`CLI-${slug(row.clientCode||row.client||row.company||'GEN')}`;
  try {
    let verifiedPlan=null;
    if (context) {
      if (!clientId||!servicePlanId||!serviceTier) return respond({error:'Klien dan service tier wajib ditentukan sebelum import.'},409);
      verifiedPlan=await d1First(database,`SELECT sp.* FROM client_service_plans sp JOIN clients c ON c.id=sp.client_id
        WHERE sp.id=? AND sp.client_id=? AND sp.tier=? AND (sp.project_id IS NULL OR sp.project_id=?) AND sp.status='ACTIVE' AND c.org_id=?
        AND sp.effective_from<=date('now') AND (sp.effective_until IS NULL OR sp.effective_until>=date('now')) LIMIT 1`,
        [servicePlanId,clientId,serviceTier,projectId||null,organizationId]);
      if (!verifiedPlan) return respond({error:'Service tier klien belum aktif atau tidak cocok.'},409);
      if (projectId) {
        const project=await d1First(database,'SELECT id FROM projects WHERE id=? AND client_id=? AND org_id=? LIMIT 1',[projectId,clientId,organizationId]);
        if (!project) return respond({error:'Project import tidak sesuai dengan klien.'},409);
      }
      let affected=0;
      for (const group of chunks(rows.map((row)=>String(row.nrk)),80)) {
        const result=await d1First(database,`SELECT COUNT(*) AS count FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
          JOIN payroll_submissions s ON s.client_id=e.client_id AND (s.project_id IS NULL OR s.project_id=e.project_id)
          WHERE e.id IN (${group.map(()=>'?').join(',')}) AND ec.payroll_source_period=? AND s.period=?
          AND s.state IN ('PAYMENT_INSTRUCTION_READY','PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','COMPLETED')`,
          [...group,period,period]);
        affected+=Number(result?.count||0);
      }
      if (affected) return respond({error:`${affected} karyawan pada file ini sudah masuk payroll ${period} yang terkunci; gunakan alur revisi controller.`,code:'LOCKED_PAYROLL_EMPLOYEE_CONFLICT',affectedEmployees:affected},409);
    }
    if (actor.role==='CLIENT_USER') {
      const allowedClients=clientIdsFor(actor,env)||[],allowedProjects=projectIdsFor(actor)||[];
      const requested=[...new Set(rows.map(rowClientId))];
      if (!allowedClients.length||requested.some((id)=>!allowedClients.includes(id))) return respond({error:'Import hanya boleh untuk klien yang ditetapkan pada akun Anda.'},403);
      if (allowedProjects.length&&(!projectId||!allowedProjects.includes(projectId))) return respond({error:'Import hanya boleh untuk project yang ditetapkan pada akun Anda.'},403);
      for (const group of chunks(rows.map((row)=>String(row.nrk)),80)) {
        const found=await d1All(database,`SELECT id,client_id FROM employees WHERE id IN (${group.map(()=>'?').join(',')})`,group);
        if (found.some((employee)=>!allowedClients.includes(employee.client_id))) return respond({error:'Import memuat ID karyawan milik klien lain.'},403);
      }
    }
    const existingIds=new Set();
    for (const group of chunks(rows.map((row)=>String(row.nrk)),80)) {
      for (const found of await d1All(database,`SELECT id FROM employees WHERE id IN (${group.map(()=>'?').join(',')})`,group)) existingIds.add(found.id);
    }
    const inserted=rows.filter((row)=>!existingIds.has(row.nrk)).length,updated=rows.length-inserted,provinceStats={};
    for (const row of rows) provinceStats[row.province||'Tidak diketahui']=(provinceStats[row.province||'Tidak diketahui']||0)+1;

    const clientRows=unique(rows,(row)=>rowClientId(row)).map((row)=>[rowClientId(row),organizationId,String(row.clientCode||slug(row.client||row.company||'GEN')),String(row.client||row.company||'Unknown')]);
    const branchRows=unique(rows,(row)=>`BR-${slug(row.branch||'NA')}`).map((row)=>[`BR-${slug(row.branch||'NA')}`,organizationId,String(row.branch||'NA'),row.kotaUmk||null,row.province||null]);
    const locationRows=unique(rows,(row)=>`LOC-${slug(row.lokasi||row.branch||row.nrk)}`).map((row)=>[`LOC-${slug(row.lokasi||row.branch||row.nrk)}`,`BR-${slug(row.branch||'NA')}`,String(row.lokasi||row.branch||'UNKNOWN'),row.unitKerja||null,row.province||'Tidak diketahui',row.kotaUmk||null]);
    const employeeRows=rows.map((row)=>[String(row.nrk),organizationId,rowClientId(row),projectId,`BR-${slug(row.branch||'NA')}`,`LOC-${slug(row.lokasi||row.branch||row.nrk)}`,`EMP-${slug(row.nrk)}`,row.name,row.gender||null,row.birthPlace||null,row.birthDate||null,row.religion||null,row.phone||null,row.mobile||null,row.email||null,row.motherName||null,row.statusAktif||null,row.province||null,new Date().toISOString()]);
    const operations=[{statement:'INSERT OR IGNORE INTO organizations(id,name,code) VALUES(?,?,?)',bindings:[organizationId,'OTSINDO','OTSINDO']},
      ...bulk('clients',['id','org_id','code','name'],clientRows,`ON CONFLICT(id) DO UPDATE SET name=${actor.role==='CLIENT_USER'?'clients.name':'excluded.name'}`),
      ...bulk('branches',['id','org_id','name','city_umk','province'],branchRows,'ON CONFLICT(id) DO UPDATE SET city_umk=COALESCE(excluded.city_umk,branches.city_umk),province=COALESCE(excluded.province,branches.province)'),
      ...bulk('work_locations',['id','branch_id','name','unit_kerja','province','city_umk'],locationRows,'ON CONFLICT(id) DO UPDATE SET province=excluded.province,unit_kerja=COALESCE(excluded.unit_kerja,work_locations.unit_kerja),city_umk=COALESCE(excluded.city_umk,work_locations.city_umk)'),
      ...bulk('employees',['id','org_id','client_id','project_id','branch_id','location_id','employee_code','name','gender','birth_place','birth_date','religion','phone','mobile','email','mother_name','status_aktif','province','updated_at'],employeeRows,`ON CONFLICT(id) DO UPDATE SET name=excluded.name,client_id=excluded.client_id,project_id=COALESCE(excluded.project_id,employees.project_id),branch_id=excluded.branch_id,location_id=excluded.location_id,employee_code=COALESCE(employees.employee_code,excluded.employee_code),gender=excluded.gender,birth_place=excluded.birth_place,birth_date=excluded.birth_date,religion=excluded.religion,phone=excluded.phone,mobile=excluded.mobile,email=excluded.email,mother_name=excluded.mother_name,status_aktif=excluded.status_aktif,province=excluded.province,updated_at=excluded.updated_at`),
      ...bulk('employee_identity',['employee_id','ktp_no','npwp_no','address','marital_status','ptkp_claimed','ptkp_updated'],rows.map((r)=>[r.nrk,r.ktp||null,r.npwp||null,r.address||null,r.marital||null,r.ptkpClaimed||null,r.ptkpUpdated||null]),'ON CONFLICT(employee_id) DO UPDATE SET ktp_no=excluded.ktp_no,npwp_no=excluded.npwp_no,address=excluded.address,marital_status=excluded.marital_status,ptkp_claimed=excluded.ptkp_claimed,ptkp_updated=excluded.ptkp_updated'),
      ...bulk('employee_contracts',['id','employee_id','employment_type','contract_status','join_date','accepted_date','contract_start','contract_end','resign_date','resign_reason','candidate_source','is_current'],rows.map((r)=>[`CTR-${r.nrk}`,r.nrk,r.employmentType||null,r.contractStatus||null,r.joinDate||null,r.acceptedDate||null,r.contractStart||null,r.contractEnd||null,r.resignDate||null,r.resignReason||null,r.candidateSource||null,1]),'ON CONFLICT(id) DO UPDATE SET employment_type=excluded.employment_type,contract_status=excluded.contract_status,join_date=excluded.join_date,accepted_date=excluded.accepted_date,contract_start=excluded.contract_start,contract_end=excluded.contract_end,resign_date=excluded.resign_date,resign_reason=excluded.resign_reason,candidate_source=excluded.candidate_source,is_current=1'),
      ...bulk('employee_assignments',['id','employee_id','position','pic','hrbp','is_current'],rows.map((r)=>[`ASG-${r.nrk}`,r.nrk,r.position||null,r.pic||null,r.hrbp||null,1]),'ON CONFLICT(id) DO UPDATE SET position=excluded.position,pic=excluded.pic,hrbp=excluded.hrbp,is_current=1'),
      ...bulk('employee_compensation',['employee_id','basic_salary','salary_start','payroll_source_period','imported_gross','imported_deduction','imported_net','payroll_components'],rows.map((r)=>[r.nrk,r.basicSalary||0,r.salaryStart||null,period,r.grossPay||0,r.totalDeductions||0,r.netPay||0,JSON.stringify(r.payrollComponents||{})]),`ON CONFLICT(employee_id) DO UPDATE SET basic_salary=excluded.basic_salary,salary_start=excluded.salary_start,payroll_source_period=excluded.payroll_source_period,imported_gross=excluded.imported_gross,imported_deduction=excluded.imported_deduction,imported_net=excluded.imported_net,payroll_components=excluded.payroll_components,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`),
      ...bulk('employee_bpjs',['employee_id','bpjs_kesehatan_no','bpjs_kesehatan_effective','jamsostek_no'],rows.map((r)=>[r.nrk,r.bpjsKes||null,r.bpjsKesEffective||null,r.jamsostek||null]),`ON CONFLICT(employee_id) DO UPDATE SET bpjs_kesehatan_no=excluded.bpjs_kesehatan_no,bpjs_kesehatan_effective=excluded.bpjs_kesehatan_effective,jamsostek_no=excluded.jamsostek_no,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`),
      ...bulk('employee_hris_meta',['employee_id','hris_user'],rows.map((r)=>[r.nrk,r.hrisUser||null]),'ON CONFLICT(employee_id) DO UPDATE SET hris_user=excluded.hris_user')];
    const bankRows=rows.filter((r)=>r.bank||r.accountNo);
    for (const group of chunks(bankRows.map((r)=>String(r.nrk)),80)) operations.push({statement:`UPDATE employee_bank_accounts SET is_primary=0 WHERE employee_id IN (${group.map(()=>'?').join(',')})`,bindings:group});
    operations.push(...bulk('employee_bank_accounts',['id','employee_id','bank_name','account_no','is_primary'],bankRows.map((r)=>[`BNK-${r.nrk}`,r.nrk,r.bank||null,r.accountNo||null,1]),'ON CONFLICT(id) DO UPDATE SET bank_name=excluded.bank_name,account_no=excluded.account_no,is_primary=1'));
    const education=rows.filter((r)=>r.educationLevel||r.school);
    operations.push(...bulk('employee_education',['id','employee_id','level','school_name','major','graduate_year','is_highest'],education.map((r)=>[`EDU-${r.nrk}`,r.nrk,r.educationLevel||null,r.school||null,r.major||null,r.graduateYear||null,1]),'ON CONFLICT(id) DO UPDATE SET level=excluded.level,school_name=excluded.school_name,major=excluded.major,graduate_year=excluded.graduate_year,is_highest=1'));
    const submissionId=verifiedPlan?`SUB-${crypto.randomUUID()}`:null;
    if (submissionId) {
      operations.push({statement:`INSERT INTO payroll_submissions
        (id,org_id,client_id,project_id,service_plan_id,service_tier,period,payment_period,run_type,source_mode,input_status,state,created_by)
        VALUES(?,?,?,?,?,?,?,?,'REGULAR','UPLOAD_FINAL','READY','AI_VALIDATING',?)`,bindings:[submissionId,organizationId,clientId,projectId,servicePlanId,serviceTier,period,period,actor.email]});
      operations.push(...bulk('payroll_run_lines',
        ['id','submission_id','employee_id','employee_code','employee_name','employment_status','bank_name','account_last4','gross_amount','deduction_amount','net_amount','components','source','included'],
        rows.map((row)=>[`PRL-${crypto.randomUUID()}`,submissionId,String(row.nrk),`EMP-${slug(row.nrk)}`,row.name,row.statusAktif||'ACTIVE',row.bank||null,String(row.accountNo||'').slice(-4)||null,row.grossPay||0,row.totalDeductions||0,row.netPay||0,JSON.stringify(row.payrollComponents||{}),'UPLOAD_FINAL',1])));
    }
    operations.push({statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity) VALUES(?,?,?,?,?,?,?)`,bindings:[`LOG-IMP-${crypto.randomUUID()}`,organizationId,actor.email,actor.role,'EMPLOYEE_IMPORT',`Import ${inserted} new, ${updated} updated, 0 errors`,'Employee']});
    await d1Batch(database,operations);
    return respond({ok:true,atomic:true,inserted,updated,errors:0,errorSamples:[],provinceStats,total:rows.length,submissionId,serviceTier,clientId,projectId});
  } catch(error) {
    return respond({ok:false,atomic:true,error:'Import transaction failed',...publicError(error,requestId)},500);
  }
}
