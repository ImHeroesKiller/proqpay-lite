"use client";
import { useEffect, useState } from "react";
type Configuration={enabled:number;limit_mode:"PERCENT"|"FIXED";limit_percent:number;fixed_limit:number;salary_mode:"AUTO"|"MANUAL";manual_salary:number|null;manual_period:string|null;version:number};
type Details={settings:Configuration|null;basis:{salary:number;period:string|null;source:string};limit:number;canWrite:boolean};
const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
export default function EwaEnrollment({employeeId}:{employeeId:string}){
 const [details,setDetails]=useState<Details|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [enabled,setEnabled]=useState(false),[mode,setMode]=useState("PERCENT"),[percent,setPercent]=useState("30"),[fixed,setFixed]=useState("0"),[salaryMode,setSalaryMode]=useState("AUTO"),[salary,setSalary]=useState(""),[period,setPeriod]=useState(""),[reason,setReason]=useState("");
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setDetails(null);setMessage("");setReason("");
  void fetch(`/api/ewa-enrollment?employeeId=${encodeURIComponent(employeeId)}`,{cache:"no-store",signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d;}).then(data=>{
   setDetails(data);const s=data.settings as Configuration|null;setEnabled(Boolean(s?.enabled));setMode(s?.limit_mode||"PERCENT");setPercent(String((s?.limit_percent??.3)*100));setFixed(String(s?.fixed_limit??0));setSalaryMode(s?.salary_mode||"AUTO");setSalary(s?.manual_salary?String(s.manual_salary):"");setPeriod(s?.manual_period||"");
  }).catch(e=>{if(e.name!=="AbortError")setMessage(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[employeeId]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(!details?.canWrite||busy)return;setBusy(true);setMessage("");
  try{const r=await fetch('/api/ewa-enrollment',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({employeeId,enabled,limitMode:mode,limitPercent:Number(percent)/100,fixedLimit:Number(fixed),salaryMode,manualSalary:Number(salary),manualPeriod:period,reason,version:details.settings?.version||0})});const data=await r.json();if(!r.ok)throw Error(data.error);setDetails({...data,canWrite:true});setReason("");setMessage("Pengaturan EWA tersimpan. Karyawan dapat mengajukan melalui ESS; persetujuan klien tetap wajib.");}
  catch(e){setMessage(e instanceof Error?e.message:"Gagal menyimpan pengaturan");}finally{setBusy(false);}
 }
 const canWrite=Boolean(details?.canWrite);
 return <section className="ewa-enrollment" aria-label="Pengaturan EWA karyawan" aria-busy={loading||busy}>
  <h3>Pendaftaran &amp; Limit EWA</h3>
  <p>Aktifkan karyawan payroll ini untuk pengajuan advance melalui ESS. Setiap pengajuan mengikuti persetujuan klien, Processor, dan Controller.</p>
  {loading?<p role="status">Memuat pengaturan EWA…</p>:null}
  {message?<p role="status">{message}</p>:null}
  {details?<form onSubmit={e=>void save(e)}>
   <p>Gaji acuan tersimpan: <strong>{rupiah(details.basis.salary)}</strong> · Periode {details.basis.period||"belum tersedia"} · {details.basis.source==="MANUAL_CONFIRMED"?"Input terkonfirmasi":details.basis.source==="MISSING"?"Perlu input gaji":"Riwayat payroll"}</p>
   <p>Limit tersimpan: <strong>{rupiah(details.limit)}</strong></p>
   <fieldset disabled={!canWrite||busy}>
    <label className="ewa-activation-toggle"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /> Aktifkan EWA</label>
    <label>Sumber gaji<select aria-label="Sumber gaji" className="input" value={salaryMode} onChange={e=>setSalaryMode(e.target.value)}><option value="AUTO">Gaji terakhir dari payroll</option><option value="MANUAL">Input / konfirmasi gaji acuan</option></select></label>
    {salaryMode==="MANUAL"?<><label>Gaji bersih acuan (Rp)<input className="input" type="number" min="1" max="1000000000" step="1" required value={salary} onChange={e=>setSalary(e.target.value)} /></label><label>Periode gaji acuan<input className="input" type="month" required value={period} onChange={e=>setPeriod(e.target.value)} /></label></>:null}
    <label>Metode limit<select aria-label="Metode limit" className="input" value={mode} onChange={e=>setMode(e.target.value)}><option value="PERCENT">Persentase gaji acuan</option><option value="FIXED">Nominal tetap dari klien / Processor</option></select></label>
    {mode==="PERCENT"?<label>Limit (% gaji acuan)<input className="input" type="number" min="0.01" max="100" step="0.01" required value={percent} onChange={e=>setPercent(e.target.value)} /></label>:<label>Limit khusus (Rp)<input className="input" type="number" min="0" max="1000000000" step="1" required value={fixed} onChange={e=>setFixed(e.target.value)} /></label>}
    <label>Alasan perubahan<textarea className="input" minLength={5} maxLength={240} required value={reason} onChange={e=>setReason(e.target.value)} /></label>
    <button className="btn btn-primary" type="submit">{busy?"Menyimpan…":"Simpan pengaturan EWA"}</button>
   </fieldset>
  </form>:null}
 </section>;
}
