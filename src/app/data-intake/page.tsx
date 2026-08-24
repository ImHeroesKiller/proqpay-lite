'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseIapWorkbook } from '@/lib/excel-iap';
import { formatIDR } from '@/lib/format';

type Setup = { clients:any[]; projects:any[]; servicePlans:any[] };
type MissingResolution = { resolution:'NO_PAY_THIS_PERIOD'|'RESIGNED'|'TRANSFERRED'|'OTHER'; note?:string };

export default function DataIntakePage() {
  const inputRef=useRef<HTMLInputElement>(null);
  const [actor,setActor]=useState<any>(null);
  const [setup,setSetup]=useState<Setup>({clients:[],projects:[],servicePlans:[]});
  const [form,setForm]=useState({clientId:'',projectId:'',period:new Date().toISOString().slice(0,7)});
  const [file,setFile]=useState<File|null>(null);
  const [parsed,setParsed]=useState<any|null>(null);
  const [preview,setPreview]=useState<any|null>(null);
  const [resolutions,setResolutions]=useState<Record<string,MissingResolution>>({});
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    void Promise.all([
      fetch('/api/me').then(async r=>{const x=await r.json();if(!r.ok)throw new Error(x.error||'Unauthorized');return x.user;}),
      fetch('/api/payroll-intake-setup').then(async r=>{const x=await r.json();if(!r.ok)throw new Error(x.error||'Setup gagal dimuat');return x;}),
    ]).then(([user,data])=>{setActor(user);setSetup({clients:data.clients||[],projects:data.projects||[],servicePlans:data.servicePlans||[]});}).catch(e=>setMessage(e.message));
  },[]);

  const projects=useMemo(()=>setup.projects.filter(p=>p.client_id===form.clientId),[setup.projects,form.clientId]);
  const plans=useMemo(()=>{
    const start=`${form.period}-01`; const [y,m]=form.period.split('-').map(Number); const end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
    const candidates=setup.servicePlans.filter(p=>p.client_id===form.clientId&&(!p.project_id||p.project_id===form.projectId)&&p.effective_from<=end&&(!p.effective_until||p.effective_until>=start));
    const exact=candidates.filter(p=>p.project_id===form.projectId); return exact.length?exact:candidates.filter(p=>!p.project_id);
  },[setup.servicePlans,form]);
  const plan=plans[0];
  const client=setup.clients.find(c=>c.id===form.clientId);
  const project=projects.find(p=>p.id===form.projectId);

  async function choose(chosen:File){
    setBusy(true);setMessage('');setPreview(null);
    try{
      if(chosen.size>8*1024*1024)throw new Error('Ukuran file maksimal 8 MB');
      const result=await parseIapWorkbook(await chosen.arrayBuffer());
      if(!result.rows.length)throw new Error('Tidak ada data payroll yang dapat dibaca');
      setFile(chosen);setParsed(result);
    }catch(e){setFile(null);setParsed(null);setMessage(e instanceof Error?e.message:'File gagal dibaca');}
    finally{setBusy(false);}
  }

  async function upload(){
    if(!file||!parsed||!client||!project||!plan)return;
    setBusy(true);setMessage('');
    try{
      const data=new FormData();
      data.set('file',file);
      data.set('rows',JSON.stringify(parsed.rows));
      data.set('context',JSON.stringify({clientId:client.id,clientCode:client.code,projectId:project.id,period:form.period,servicePlanId:plan.id,tier:plan.tier,paymentPeriod:form.period,paymentDate:`${form.period}-25`}));
      data.set('sourceSheet',parsed.sheetName||'PAYROLL_INPUT');
      data.set('rawRowCount',String(parsed.totalRaw||parsed.rows.length));
      data.set('templateVersion','PROQPAY_PAYROLL_V1');
      const response=await fetch('/api/payroll-intake',{method:'POST',body:data});
      const payload=await response.json(); if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
      setPreview(payload);
      const initial:Record<string,MissingResolution>={};
      (payload.missing||[]).forEach((item:any)=>{initial[item.employeeId]={resolution:'NO_PAY_THIS_PERIOD'};});
      setResolutions(initial);
      setMessage(payload.missing?.length?'Upload selesai. Konfirmasi karyawan yang tidak muncul sebelum melanjutkan.':'Upload selesai. Data siap dikonfirmasi.');
    }catch(e){setMessage(e instanceof Error?e.message:'Upload gagal');}
    finally{setBusy(false);}
  }

  async function confirm(){
    if(!preview?.batchId)return;
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/payroll-intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'CONFIRM',batchId:preview.batchId,missingResolutions:resolutions})});
      const payload=await response.json(); if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
      setPreview({...preview,confirmed:true,confirmation:payload});
      setMessage(`Payroll intake ${form.period} dikonfirmasi. ${payload.employees} karyawan masuk Pay Run.`);
    }catch(e){setMessage(e instanceof Error?e.message:'Konfirmasi gagal');}
    finally{setBusy(false);}
  }

  return <main style={{minHeight:'100vh',background:'var(--bg)',padding:'28px 20px',color:'var(--text)'}}>
    <div style={{maxWidth:1120,margin:'0 auto',display:'grid',gap:16}}>
      <header style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
        <div><span style={{fontSize:11,fontWeight:800,letterSpacing:'.12em',color:'var(--accent)'}}>PAYROLL DATA INTAKE</span><h1 style={{fontSize:26,margin:'5px 0'}}>Data Intake Payroll</h1><p style={{margin:0,color:'var(--text3)',fontSize:13}}>Satu file per client, project, dan periode. Backend memperbarui master terbaru, menyimpan history, lalu membentuk Pay Run snapshot.</p></div>
        <a className="btn" href="/?view=operations">← Pay Runs</a>
      </header>

      {message?<div className={`app-notice-bubble ${/gagal|error|tidak|wajib/i.test(message)?'app-notice-error':'app-notice-info'}`}><strong>{/gagal|error|tidak|wajib/i.test(message)?'Perlu perhatian':'Informasi'}</strong><span>{message}</span></div>:null}

      <section className="card" style={{padding:18,display:'grid',gap:14}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12}}>
          <label>Client<select value={form.clientId} onChange={e=>setForm({clientId:e.target.value,projectId:'',period:form.period})}><option value="">Pilih client</option>{setup.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Project<select value={form.projectId} disabled={!form.clientId} onChange={e=>setForm({...form,projectId:e.target.value})}><option value="">Pilih project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Periode Payroll<input type="month" value={form.period} onChange={e=>setForm({...form,period:e.target.value})}/></label>
          <label>Service Tier<input readOnly value={plan?String(plan.tier).replaceAll('_',' '):'Belum ada tier aktif'}/></label>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <input ref={inputRef} hidden type="file" accept=".xlsx,.xls" onChange={e=>{const f=e.target.files?.[0];if(f)void choose(f);}}/>
          <button className="btn" disabled={busy||!client||!project||!plan} onClick={()=>inputRef.current?.click()}>{file?'Ganti file':'Pilih file payroll'}</button>
          <span style={{fontSize:12,color:'var(--text3)'}}>{file?file.name:'Gunakan template ProQPay Payroll v1'}</span>
        </div>
        {parsed?<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
          <Metric label="Karyawan" value={String(parsed.rows.length)}/><Metric label="Gross" value={formatIDR(parsed.payrollSummary.gross)}/><Metric label="Deduction" value={formatIDR(parsed.payrollSummary.deductions)}/><Metric label="Net/THP" value={formatIDR(parsed.payrollSummary.net)}/>
        </div>:null}
        {parsed&&!preview?<button className="btn btn-primary" disabled={busy||!plan} onClick={()=>void upload()}>{busy?'Menganalisis…':'Upload & Analisis'}</button>:null}
      </section>

      {preview?<section className="card" style={{padding:18,display:'grid',gap:14}}>
        <div><span style={{fontSize:11,fontWeight:800,color:'var(--accent)'}}>BACKEND COMPARISON</span><h2 style={{fontSize:18,margin:'4px 0'}}>Hasil Data Intake</h2></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
          <Metric label="Matched" value={String(preview.comparison?.matched||0)}/><Metric label="Employee Baru" value={String(preview.comparison?.new||0)}/><Metric label="Data Berubah" value={String(preview.comparison?.changed||0)}/><Metric label="Tidak Muncul" value={String(preview.comparison?.missing||0)}/>
        </div>
        {(preview.changes||[]).length?<details open><summary><strong>Perubahan master terdeteksi ({preview.changes.length})</strong></summary><div style={{display:'grid',gap:7,marginTop:10}}>{preview.changes.slice(0,30).map((x:any)=><div key={`${x.employeeId}-${x.row}`} style={{padding:'9px 11px',border:'1px solid var(--border-soft)',borderRadius:9}}><strong>{x.nrk} · {x.name}</strong><small style={{display:'block',color:'var(--text3)',marginTop:3}}>{x.changedFields.join(', ')}</small></div>)}</div></details>:null}
        {(preview.newEmployees||[]).length?<details><summary><strong>Employee baru ({preview.newEmployees.length})</strong></summary><div style={{marginTop:8,color:'var(--text2)',fontSize:13}}>{preview.newEmployees.map((x:any)=>`${x.nrk} · ${x.name}`).join(', ')}</div></details>:null}
        {(preview.missing||[]).length?<div style={{display:'grid',gap:10}}><strong>Karyawan tidak terdapat pada payroll {form.period}</strong><span style={{fontSize:12,color:'var(--text3)'}}>Konfirmasi alasannya. Tidak menerima gaji periode ini tidak mengubah status master.</span>{preview.missing.map((item:any)=><div key={item.employeeId} style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) 220px minmax(180px,1fr)',gap:8,alignItems:'center'}}><div><strong>{item.nrk}</strong><small style={{display:'block',color:'var(--text3)'}}>{item.name}</small></div><select value={resolutions[item.employeeId]?.resolution||'NO_PAY_THIS_PERIOD'} onChange={e=>setResolutions({...resolutions,[item.employeeId]:{...(resolutions[item.employeeId]||{}),resolution:e.target.value as MissingResolution['resolution']}})}><option value="NO_PAY_THIS_PERIOD">Tidak menerima gaji periode ini</option><option value="RESIGNED">Resign / terminated</option><option value="TRANSFERRED">Mutasi project</option><option value="OTHER">Lainnya</option></select><input placeholder="Catatan opsional" value={resolutions[item.employeeId]?.note||''} onChange={e=>setResolutions({...resolutions,[item.employeeId]:{...(resolutions[item.employeeId]||{resolution:'NO_PAY_THIS_PERIOD'}),note:e.target.value}})}/></div>)}</div>:null}
        {!preview.confirmed?<button className="btn btn-primary" disabled={busy} onClick={()=>void confirm()}>{busy?'Menyimpan master & snapshot…':'Konfirmasi Intake & Buat Pay Run'}</button>:<div className="app-notice-bubble app-notice-info"><strong>Intake selesai</strong><span>Master terbaru sudah diperbarui dengan history dan snapshot payroll periode ini sudah tersedia.</span><a className="btn btn-primary" href="/?view=operations">Buka Pay Run</a></div>}
      </section>:null}

      <footer style={{fontSize:11,color:'var(--text3)'}}>Login: {actor?.email||'-'} · Template contract: PROQPAY_PAYROLL_V1 · Satu upload sumber per periode.</footer>
    </div>
  </main>;
}

function Metric({label,value}:{label:string;value:string}) { return <div style={{padding:12,border:'1px solid var(--border-soft)',borderRadius:10,background:'var(--bg-subtle)'}}><span style={{display:'block',fontSize:10,color:'var(--text3)',textTransform:'uppercase'}}>{label}</span><strong style={{display:'block',marginTop:5,fontSize:17}}>{value}</strong></div>; }