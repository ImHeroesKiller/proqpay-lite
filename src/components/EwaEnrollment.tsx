"use client";
import { useEffect, useState } from "react";

type Employee={id:string;name:string;employee_code?:string;client_name?:string;ewa_enabled?:number};
type Configuration={enabled:number;limit_mode:"PERCENT"|"FIXED";limit_percent:number;fixed_limit:number;salary_mode:"AUTO"|"MANUAL";manual_salary:number|null;manual_period:string|null;version:number};
type Details={settings:Configuration|null;basis:{salary:number;period:string|null;source:string};limit:number};
const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
export default function EwaEnrollment(){
 const [projects,setProjects]=useState<{id:string;name:string}[]>([]),[newName,setNewName]=useState(""),[newCode,setNewCode]=useState(""),[newProject,setNewProject]=useState(""),[newReason,setNewReason]=useState("");
 const [employees,setEmployees]=useState<Employee[]>([]),[q,setQ]=useState(""),[offset,setOffset]=useState(0),[more,setMore]=useState(false);
 const [id,setId]=useState(""),[details,setDetails]=useState<Details|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[canWrite,setCanWrite]=useState(false);
 const [enabled,setEnabled]=useState(false),[mode,setMode]=useState("PERCENT"),[percent,setPercent]=useState("30"),[fixed,setFixed]=useState("0"),[salaryMode,setSalaryMode]=useState("AUTO"),[salary,setSalary]=useState(""),[period,setPeriod]=useState(""),[reason,setReason]=useState("");
 useEffect(()=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>{void fetch(`/api/ewa-enrollment?q=${encodeURIComponent(q)}&offset=${offset}`,{signal:controller.signal,cache:"no-store"}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data;}).then(data=>{setEmployees(data.employees);setProjects(data.projects);setMore(data.hasMore);setCanWrite(data.canWrite);}).catch(e=>{if(e.name!=="AbortError")setMessage(e.message);});},250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[q,offset]);
 async function selectEmployee(employeeId:string){
  setId(employeeId);setDetails(null);setMessage("");setReason("");if(!employeeId)return;setBusy(true);
  try{const r=await fetch(`/api/ewa-enrollment?employeeId=${encodeURIComponent(employeeId)}`,{cache:"no-store"});const data=await r.json();if(!r.ok)throw Error(data.error);setDetails(data);const s=data.settings as Configuration|null;setEnabled(Boolean(s?.enabled));setMode(s?.limit_mode||"PERCENT");setPercent(String((s?.limit_percent??.3)*100));setFixed(String(s?.fixed_limit??0));setSalaryMode(s?.salary_mode||"AUTO");setSalary(s?.manual_salary?String(s.manual_salary):"");setPeriod(s?.manual_period||"");}
  catch(e){setMessage(e instanceof Error?e.message:"Gagal memuat pengaturan");}finally{setBusy(false);}
 }
 async function register(e:React.FormEvent){
  e.preventDefault();if(busy||!canWrite)return;setBusy(true);setMessage("");
  try{const r=await fetch('/api/ewa-enrollment',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"REGISTER",name:newName,employeeCode:newCode,projectId:newProject,reason:newReason})});const data=await r.json();if(!r.ok)throw Error(data.error);setEmployees(rows=>[data.employee,...rows]);setNewName("");setNewCode("");setNewReason("");await selectEmployee(data.employee.id);setMessage("Karyawan terdaftar. Lengkapi gaji acuan dan pengaturan EWA di bawah. Rekening serta akses ESS dilengkapi melalui pengelola payroll.");}
  catch(e){setMessage(e instanceof Error?e.message:"Gagal mendaftarkan karyawan");}finally{setBusy(false);}
 }
 async function save(e:React.FormEvent){
  e.preventDefault();if(!details||busy||!canWrite)return;setBusy(true);setMessage("");
  try{const r=await fetch('/api/ewa-enrollment',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({employeeId:id,enabled,limitMode:mode,limitPercent:Number(percent)/100,fixedLimit:Number(fixed),salaryMode,manualSalary:Number(salary),manualPeriod:period,reason,version:details.settings?.version||0})});const data=await r.json();if(!r.ok)throw Error(data.error);setDetails(data);setEmployees(rows=>rows.map(row=>row.id===id?{...row,ewa_enabled:enabled?1:0}:row));setReason("");setMessage("Pengaturan EWA tersimpan. Setiap pengajuan tetap memerlukan persetujuan klien.");}
  catch(e){setMessage(e instanceof Error?e.message:"Gagal menyimpan pengaturan");}finally{setBusy(false);}
 }
 return <section className="card ewa-enrollment" aria-label="Pendaftaran dan pengaturan EWA">
  <h2>Daftarkan &amp; Atur EWA Karyawan</h2>
  <p>Klien dan Payroll Processor dapat menetapkan gaji acuan, limit, serta aktivasi. Persetujuan klien tetap wajib untuk setiap pengajuan.</p>
  {canWrite?<details><summary>Daftarkan karyawan baru</summary><form onSubmit={e=>void register(e)}><fieldset disabled={busy}>
   <label>Nama karyawan<input className="input" minLength={2} maxLength={150} required value={newName} onChange={e=>setNewName(e.target.value)} /></label>
   <label>Kode karyawan<input className="input" pattern="[-A-Za-z0-9_.]{1,60}" required value={newCode} onChange={e=>setNewCode(e.target.value)} /></label>
   <label>Project<select aria-label="Project" className="input" required value={newProject} onChange={e=>setNewProject(e.target.value)}><option value="">Pilih project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>Alasan pendaftaran<textarea className="input" minLength={5} maxLength={240} required value={newReason} onChange={e=>setNewReason(e.target.value)} /></label>
   <button className="btn" type="submit">Daftarkan karyawan</button>
  </fieldset></form></details>:null}
  <label>Cari karyawan<input className="input" value={q} disabled={busy} onChange={e=>{setQ(e.target.value);setOffset(0);setId("");setDetails(null);}} placeholder="Nama atau kode karyawan" /></label>
  <label>Karyawan<select aria-label="Karyawan" className="input" value={id} disabled={busy} onChange={e=>void selectEmployee(e.target.value)}><option value="">Pilih karyawan terdaftar</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name} · {e.employee_code||e.id} · {e.ewa_enabled?"EWA aktif":"Belum aktif"}</option>)}</select></label>
  <div className="ewa-row-actions"><button type="button" className="btn" disabled={offset===0||busy} onClick={()=>{setOffset(n=>Math.max(0,n-50));setId("");setDetails(null);}}>Sebelumnya</button><button type="button" className="btn" disabled={!more||busy} onClick={()=>{setOffset(n=>n+50);setId("");setDetails(null);}}>Berikutnya</button></div>
  {message?<p role="status">{message}</p>:null}
  {details?<form onSubmit={e=>void save(e)}>
   <p>Gaji acuan tersimpan: <strong>{rupiah(details.basis.salary)}</strong> · Periode {details.basis.period||"belum tersedia"} · {details.basis.source==="MANUAL_CONFIRMED"?"Input terkonfirmasi":details.basis.source==="MISSING"?"Perlu input gaji":"Riwayat payroll"}</p>
   <p>Limit tersimpan: <strong>{rupiah(details.limit)}</strong></p>
   <fieldset disabled={!canWrite||busy}>
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /> Aktifkan EWA</label>
    <label>Sumber gaji<select aria-label="Sumber gaji" className="input" value={salaryMode} onChange={e=>setSalaryMode(e.target.value)}><option value="AUTO">Gaji terakhir dari payroll</option><option value="MANUAL">Input / konfirmasi gaji acuan</option></select></label>
    {salaryMode==="MANUAL"?<><label>Gaji bersih acuan (Rp)<input className="input" type="number" min="1" max="1000000000" step="1" required value={salary} onChange={e=>setSalary(e.target.value)} /></label><label>Periode gaji acuan<input className="input" type="month" required value={period} onChange={e=>setPeriod(e.target.value)} /></label></>:null}
    <label>Metode limit<select aria-label="Metode limit" className="input" value={mode} onChange={e=>setMode(e.target.value)}><option value="PERCENT">Persentase gaji acuan</option><option value="FIXED">Nominal tetap dari klien / Processor</option></select></label>
    {mode==="PERCENT"?<label>Limit (% gaji acuan)<input className="input" type="number" min="0.01" max="100" step="0.01" required value={percent} onChange={e=>setPercent(e.target.value)} /></label>:<label>Limit khusus (Rp)<input className="input" type="number" min="0" max="1000000000" step="1" required value={fixed} onChange={e=>setFixed(e.target.value)} /></label>}
    <p>Tanggal bergabung dan prorata kalender tidak digunakan pada pengaturan EWA ini.</p>
    <label>Alasan perubahan<textarea className="input" minLength={5} maxLength={240} required value={reason} onChange={e=>setReason(e.target.value)} /></label>
    <button className="btn btn-primary" type="submit">{busy?"Menyimpan…":"Simpan pengaturan EWA"}</button>
   </fieldset>
  </form>:null}
 </section>;
}
