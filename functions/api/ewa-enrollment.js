import { d1All,d1Batch,d1First,hasD1 } from './_d1.js';
import { authorize,clientIdsFor,projectIdsFor,enforceRateLimit,handlePreflight,secureJson,publicError } from './_security.js';
import { employeeEwaConfiguration, loadEwaSalary } from './_ewa-entitlement.js';
const METHODS='GET, POST, OPTIONS';
const WRITERS=new Set(['SUPER_ADMIN','PAYROLL_PROCESSOR','CLIENT_USER']);
function scope(actor,env){
 const clauses=['e.org_id=?'];const values=[actor.orgId || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'];
 if(actor.role==='CLIENT_USER'){
  const clients=clientIdsFor(actor,env)||[],projects=projectIdsFor(actor)||[];
  if(!clients.length||!projects.length)clauses.push('1=0');
  else{clauses.push(`e.client_id IN (${clients.map(()=>'?').join(',')}) AND e.project_id IN (${projects.map(()=>'?').join(',')})`);values.push(...clients,...projects);}
 }
 return {where:clauses.join(' AND '),values};
}
function positiveInteger(value,allowZero=false){return Number.isSafeInteger(value)&&value>=(allowZero?0:1)&&value<=1000000000;}
export async function onRequest({request,env}){
 if(request.method==='OPTIONS')return handlePreflight(request,env,METHODS);
 const respond=(data,status=200)=>secureJson(data,status,request,env,METHODS);
 if(!['GET','POST'].includes(request.method))return respond({error:'Method not allowed'},405);
 const auth=await authorize(request,env,{roles:['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'],mutating:request.method==='POST',methods:METHODS});
 if(auth.response)return auth.response;
 if(!hasD1(env))return respond({error:'Database unavailable'},503);
 const actor=auth.actor,limited=await enforceRateLimit(request,env,actor,'ewa-enrollment',METHODS);if(limited)return limited;
 if(request.method==='POST'&&!WRITERS.has(actor.role))return respond({error:'Tidak memiliki izin mengatur EWA'},403);
 const scoped=scope(actor,env);
 try{
  const params=new URL(request.url).searchParams;
  if(request.method==='GET'){
   const id=String(params.get('employeeId')||'').slice(0,100);
   if(id){
    const employee=await d1First(env.DB,`SELECT e.id,e.name,e.client_id,e.project_id FROM employees e WHERE ${scoped.where} AND e.id=?`,[...scoped.values,id]);
    if(!employee)return respond({error:'Karyawan tidak ditemukan'},404);
    return respond({ok:true,employee,...await employeeEwaConfiguration(env.DB,id,employee.org_id||scoped.values[0],employee.client_id)});
   }
   const q=String(params.get('q')||'').trim().slice(0,80),offset=Math.max(0,Number.parseInt(params.get('offset')||'0',10)||0);
   const where=scoped.where+" AND (e.name LIKE ? OR e.employee_code LIKE ?)";const values=[...scoped.values,`%${q}%`,`%${q}%`];
   const employees=await d1All(env.DB,`SELECT e.id,e.name,e.employee_code,e.client_id,e.project_id,c.name AS client_name,COALESCE(s.enabled,0) AS ewa_enabled
    FROM employees e LEFT JOIN clients c ON c.id=e.client_id LEFT JOIN ewa_employee_settings s ON s.employee_id=e.id AND s.org_id=e.org_id AND s.client_id=e.client_id
    WHERE ${where} ORDER BY e.name,e.id LIMIT 50 OFFSET ?`,[...values,offset]);
   const projects=await d1All(env.DB,`SELECT e.id,e.name,e.client_id FROM projects e WHERE ${scoped.where.replaceAll('e.project_id','e.id')} ORDER BY e.name LIMIT 200`,scoped.values);
   return respond({ok:true,employees,projects,offset,hasMore:employees.length===50,canWrite:WRITERS.has(actor.role)});
  }
  let body;try{body=await request.json();}catch{return respond({error:'JSON tidak valid'},400);}
  if(body.action==='REGISTER'){
    const project=await d1First(env.DB,`SELECT e.* FROM projects e WHERE ${scoped.where.replaceAll('e.project_id','e.id')} AND e.id=?`,[...scoped.values,String(body.projectId||'')]);
    if(!project)return respond({error:'Project tidak ditemukan'},404);
    const name=String(body.name||'').trim(),code=String(body.employeeCode||'').trim(),reason=String(body.reason||'').trim();
    if(name.length<2||name.length>150||!/^[-A-Za-z0-9_.]{1,60}$/.test(code)||reason.length<5||reason.length>240)return respond({error:'Nama, kode karyawan dan alasan pendaftaran wajib valid'},422);
    const id=`EMP-${crypto.randomUUID()}`,actorId=String(actor.email||actor.id);
    await d1Batch(env.DB,[{statement:`INSERT INTO employees(id,org_id,client_id,project_id,employee_code,name,status_aktif) VALUES(?,?,?,?,?,?,'ACTIVE')`,bindings:[id,project.org_id,project.client_id,project.id,code,name]},
      {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?,'employee',?)`,bindings:[`AUD-${crypto.randomUUID()}`,project.org_id,actorId,actor.role,'EWA_EMPLOYEE_REGISTERED',JSON.stringify({name,code,reason,projectId:project.id}),id]}]);
    return respond({ok:true,employee:{id,name,employee_code:code,client_id:project.client_id,project_id:project.id}},201);
  }
  const employee=await d1First(env.DB,`SELECT e.* FROM employees e WHERE ${scoped.where} AND e.id=?`,[...scoped.values,String(body.employeeId||'')]);
  if(!employee)return respond({error:'Karyawan tidak ditemukan'},404);
  const reason=String(body.reason||'').trim();
  if(reason.length<5||reason.length>240)return respond({error:'Alasan perubahan wajib 5–240 karakter'},422);
  const enabled=body.enabled;if(typeof enabled!=='boolean')return respond({error:'Status aktivasi wajib dipilih'},422);
  const mode=body.limitMode,salaryMode=body.salaryMode;
  if(!['PERCENT','FIXED'].includes(mode)||!['AUTO','MANUAL'].includes(salaryMode))return respond({error:'Metode limit/gaji tidak valid'},422);
  const percent=Number(body.limitPercent),fixed=Number(body.fixedLimit),salary=Number(body.manualSalary);
  if(!Number.isFinite(percent)||percent<=0||percent>1||!positiveInteger(fixed,true))return respond({error:'Persentase limit 0–100% dan nominal harus valid'},422);
  if(salaryMode==='MANUAL'&&(!positiveInteger(salary)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.manualPeriod||''))))return respond({error:'Gaji acuan dan periode wajib diisi dengan benar'},422);
  const current=await employeeEwaConfiguration(env.DB,employee.id,employee.org_id,employee.client_id);
  const basis=salaryMode==='MANUAL'?salary:(await loadEwaSalary(env.DB,employee.id,employee.org_id,employee.client_id)).salary;
  const limit=mode==='FIXED'?fixed:Math.floor(basis*percent/10000)*10000;
  if(enabled&&(!(basis>0)||limit<100000))return respond({error:'Gaji acuan harus tersedia dan limit aktif minimal Rp100.000'},422);
  const version=Number(current.settings?.version||0);
  if(!Number.isInteger(body.version)||body.version!==version)return respond({error:'Pengaturan berubah. Muat ulang sebelum menyimpan.'},409);
  const actorId=String(actor.email||actor.id),next={enabled,limitMode:mode,limitPercent:percent,fixedLimit:fixed,salaryMode,manualSalary:salaryMode==='MANUAL'?salary:null,manualPeriod:salaryMode==='MANUAL'?body.manualPeriod:null};
  const statement=current.settings?`UPDATE ewa_employee_settings SET enabled=?,limit_mode=?,limit_percent=?,fixed_limit=?,salary_mode=?,manual_salary=?,manual_period=?,updated_by=?,change_reason=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE employee_id=? AND org_id=? AND client_id=? AND version=?`:
   `INSERT INTO ewa_employee_settings(enabled,limit_mode,limit_percent,fixed_limit,salary_mode,manual_salary,manual_period,updated_by,change_reason,employee_id,org_id,client_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`;
  const bindings=[enabled?1:0,mode,percent,fixed,salaryMode,next.manualSalary,next.manualPeriod,actorId,reason,employee.id,employee.org_id,employee.client_id,...(current.settings?[version]:[])];
  // Conditional audit INSERT ensures stale updates leave no audit event.
  const auditId=`AUD-${crypto.randomUUID()}`;
  const results=await d1Batch(env.DB,[{statement,bindings},{statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
    SELECT ?,?,?,?,?,?,'ewa_employee_setting',? WHERE changes()=1`,bindings:[auditId,employee.org_id,actorId,actor.role,'EWA_ENROLLMENT_UPDATED',JSON.stringify({before:current.settings,after:next,reason}),employee.id]}]);
  if(Number(results[0]?.meta?.changes??results[0]?.changes??0)!==1)return respond({error:'Pengaturan berubah. Muat ulang.'},409);
  return respond({ok:true,...await employeeEwaConfiguration(env.DB,employee.id,employee.org_id,employee.client_id)});
 }catch(error){if(/UNIQUE constraint failed/.test(String(error?.message||'')))return respond({error:'Pengaturan berubah. Muat ulang atau hubungi administrator untuk perpindahan klien.'},409);return respond({error:'Gagal memproses pengaturan EWA',...publicError(error,crypto.randomUUID())},500);}
}
