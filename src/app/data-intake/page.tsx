'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
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

  const activeStep=preview?.confirmed?3:parsed?2:1;
  return <main className="intake-page">
    <div className="intake-topbar">
      <Link className="intake-brand" href="/" aria-label="Kembali ke dashboard ProQPay"><Image src="/assets/proqpay-logo.jpg" alt="ProQPay Lite" width={206} height={62} priority /></Link>
      <div><span>{actor?.name||'Payroll workspace'}</span><Link className="btn" href="/?view=operations">Kembali ke Pay Runs</Link></div>
    </div>
    <div className="intake-container">
      <header className="intake-heading">
        <div><span>PAYROLL DATA INTAKE</span><h1>Data Intake Payroll</h1><p>Unggah satu sumber payroll per klien, proyek, dan periode. ProQPay akan memvalidasi isi file sebelum membentuk snapshot Pay Run.</p></div>
        <div className="intake-security"><strong>Controlled intake</strong><span>History tersimpan · Snapshot terkunci · Siap diaudit</span></div>
      </header>

      <ol className="intake-steps" aria-label="Tahapan data intake">
        {[['1','Tentukan scope','Klien, proyek, dan periode'],['2','Unggah & analisis','Validasi file payroll'],['3','Konfirmasi intake','Bentuk snapshot Pay Run']].map(([number,title,note],index)=><li key={number} className={activeStep>index?'active':''}><i>{activeStep>index+1?'✓':number}</i><span><strong>{title}</strong><small>{note}</small></span></li>)}
      </ol>

      {message?<div className={`app-notice-bubble ${/gagal|error|tidak|wajib/i.test(message)?'app-notice-error':'app-notice-info'}`}><strong>{/gagal|error|tidak|wajib/i.test(message)?'Perlu perhatian':'Informasi'}</strong><span>{message}</span></div>:null}

      <section className="card intake-config-card">
        <div className="intake-section-heading"><div><span>LANGKAH 1</span><h2>Tentukan sumber payroll</h2></div><small>Kolom bertanda * wajib diisi</small></div>
        <div className="intake-form-grid">
          <label><span>Klien *</span><select value={form.clientId} onChange={e=>setForm({clientId:e.target.value,projectId:'',period:form.period})}><option value="">Pilih klien</option>{setup.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label><span>Proyek *</span><select value={form.projectId} disabled={!form.clientId} onChange={e=>setForm({...form,projectId:e.target.value})}><option value="">{form.clientId?'Pilih proyek':'Pilih klien lebih dulu'}</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label><span>Periode payroll *</span><input type="month" value={form.period} onChange={e=>setForm({...form,period:e.target.value})}/></label>
          <label><span>Service tier</span><input readOnly value={plan?String(plan.tier).replaceAll('_',' '):'Belum ada tier aktif'}/></label>
        </div>
        <div className={`intake-upload-zone${file?' has-file':''}`}>
          <input ref={inputRef} hidden type="file" accept=".xlsx,.xls" onChange={e=>{const f=e.target.files?.[0];if(f)void choose(f);}}/>
          <div className="intake-upload-icon" aria-hidden="true">⇧</div>
          <div><strong>{file?file.name:'Pilih file payroll untuk dianalisis'}</strong><span>{file?`${parsed?.rows.length||0} baris terbaca · Siap dianalisis`:'Format XLSX/XLS · Maksimal 8 MB · Template ProQPay Payroll v1'}</span></div>
          <button type="button" className="btn" disabled={busy||!client||!project||!plan} onClick={()=>inputRef.current?.click()}>{file?'Ganti file':'Pilih file'}</button>
        </div>
        {!client||!project||!plan?<p className="intake-helper">Pilih klien dan proyek dengan service tier aktif agar tombol unggah tersedia.</p>:null}
        {parsed?<div className="intake-metrics">
          <Metric label="Karyawan" value={String(parsed.rows.length)}/><Metric label="Gross" value={formatIDR(parsed.payrollSummary.gross)}/><Metric label="Deduction" value={formatIDR(parsed.payrollSummary.deductions)}/><Metric label="Net/THP" value={formatIDR(parsed.payrollSummary.net)}/>
        </div>:null}
        {parsed&&!preview?<div className="intake-primary-action"><span>Periksa ringkasan nominal sebelum melanjutkan.</span><button type="button" className="btn btn-primary" disabled={busy||!plan} onClick={()=>void upload()}>{busy?'Menganalisis…':'Upload & Analisis'}</button></div>:null}
      </section>

      {!parsed?<section className="intake-guidance" aria-label="Panduan upload payroll"><div><i>01</i><strong>Gunakan template standar</strong><span>Pastikan header kolom tidak diubah agar data dapat dipetakan otomatis.</span></div><div><i>02</i><strong>Periksa rekening & THP</strong><span>Data kosong atau nol akan ditandai sebelum payroll diproses.</span></div><div><i>03</i><strong>Konfirmasi perubahan</strong><span>Karyawan baru, data berubah, dan karyawan yang tidak muncul akan ditampilkan.</span></div></section>:null}

      {preview?<section className="card intake-result-card">
        <div className="intake-section-heading"><div><span>LANGKAH 2</span><h2>Hasil analisis data</h2></div><small>Backend comparison</small></div>
        <div className="intake-metrics">
          <Metric label="Matched" value={String(preview.comparison?.matched||0)}/><Metric label="Employee Baru" value={String(preview.comparison?.new||0)}/><Metric label="Data Berubah" value={String(preview.comparison?.changed||0)}/><Metric label="Tidak Muncul" value={String(preview.comparison?.missing||0)}/>
        </div>
        {(preview.changes||[]).length?<details open><summary><strong>Perubahan master terdeteksi ({preview.changes.length})</strong></summary><div style={{display:'grid',gap:7,marginTop:10}}>{preview.changes.slice(0,30).map((x:any)=><div key={`${x.employeeId}-${x.row}`} style={{padding:'9px 11px',border:'1px solid var(--border-soft)',borderRadius:9}}><strong>{x.nrk} · {x.name}</strong><small style={{display:'block',color:'var(--text3)',marginTop:3}}>{x.changedFields.join(', ')}</small></div>)}</div></details>:null}
        {(preview.newEmployees||[]).length?<details><summary><strong>Employee baru ({preview.newEmployees.length})</strong></summary><div style={{marginTop:8,color:'var(--text2)',fontSize:13}}>{preview.newEmployees.map((x:any)=>`${x.nrk} · ${x.name}`).join(', ')}</div></details>:null}
        {(preview.missing||[]).length?<div style={{display:'grid',gap:10}}><strong>Karyawan tidak terdapat pada payroll {form.period}</strong><span style={{fontSize:12,color:'var(--text3)'}}>Konfirmasi alasannya. Tidak menerima gaji periode ini tidak mengubah status master.</span>{preview.missing.map((item:any)=><div key={item.employeeId} style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) 220px minmax(180px,1fr)',gap:8,alignItems:'center'}}><div><strong>{item.nrk}</strong><small style={{display:'block',color:'var(--text3)'}}>{item.name}</small></div><select value={resolutions[item.employeeId]?.resolution||'NO_PAY_THIS_PERIOD'} onChange={e=>setResolutions({...resolutions,[item.employeeId]:{...(resolutions[item.employeeId]||{}),resolution:e.target.value as MissingResolution['resolution']}})}><option value="NO_PAY_THIS_PERIOD">Tidak menerima gaji periode ini</option><option value="RESIGNED">Resign / terminated</option><option value="TRANSFERRED">Mutasi project</option><option value="OTHER">Lainnya</option></select><input placeholder="Catatan opsional" value={resolutions[item.employeeId]?.note||''} onChange={e=>setResolutions({...resolutions,[item.employeeId]:{...(resolutions[item.employeeId]||{resolution:'NO_PAY_THIS_PERIOD'}),note:e.target.value}})}/></div>)}</div>:null}
        {!preview.confirmed?<div className="intake-primary-action"><span>Konfirmasi akan memperbarui master dengan history dan membuat snapshot periode ini.</span><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void confirm()}>{busy?'Menyimpan master & snapshot…':'Konfirmasi Intake & Buat Pay Run'}</button></div>:<div className="app-notice-bubble app-notice-info"><strong>Intake selesai</strong><span>Master terbaru sudah diperbarui dengan history dan snapshot payroll periode ini sudah tersedia.</span><Link className="btn btn-primary" href="/?view=operations">Buka Pay Run</Link></div>}
      </section>:null}

      <footer className="intake-footer"><span>Login: {actor?.email||'-'}</span><span>Template contract: PROQPAY_PAYROLL_V1</span><span>Satu upload sumber per periode</span></footer>
    </div>
  </main>;
}

function Metric({label,value}:{label:string;value:string}) { return <div className="intake-metric"><span>{label}</span><strong>{value}</strong></div>; }
