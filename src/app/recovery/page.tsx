'use client';

import { useEffect, useMemo, useState } from 'react';

type PayRun = {
  id:string;
  period:string;
  state:string;
  client_name:string;
  project_name?:string | null;
  payroll_lines:number;
  active_pi_count:number;
};

export default function RecoveryPage() {
  const [rows,setRows]=useState<PayRun[]>([]);
  const [selected,setSelected]=useState('');
  const [reason,setReason]=useState('Reset workflow agar Payment Instruction dapat dibuat ulang dari Pay Run yang sama.');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const current=useMemo(()=>rows.find((row)=>row.id===selected),[rows,selected]);

  async function load(){
    setLoading(true); setMessage('');
    try{
      const response=await fetch('/api/reset-pay-run-workflow',{cache:'no-store'});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||`HTTP ${response.status}`);
      setRows(payload.payRuns||[]);
      if(!selected&&payload.payRuns?.length===1) setSelected(payload.payRuns[0].id);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal memuat Pay Run recovery');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[]);

  async function reset(){
    if(!selected) return;
    const confirmation=window.prompt('Ketik RESET PAY RUN WORKFLOW untuk melanjutkan. Payroll snapshot tidak akan dihapus.');
    if(confirmation!=='RESET PAY RUN WORKFLOW') return;
    setBusy(true); setMessage('Memproses reset…');
    try{
      const response=await fetch('/api/reset-pay-run-workflow',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({submissionId:selected,reason,confirmation}),
      });
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||`HTTP ${response.status}`);
      setMessage(`Berhasil. Pay Run dikembalikan ke CONTROLLER_REVIEW. ${payload.after?.submission?.payroll_lines||0} baris payroll tetap dipertahankan.`);
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Reset gagal');}
    finally{setBusy(false);}
  }

  return <main style={{maxWidth:900,margin:'0 auto',padding:'28px 18px 56px'}}>
    <div style={{marginBottom:18}}><span style={{fontSize:11,fontWeight:800,letterSpacing:1.2,color:'var(--accent)'}}>PAY RUN RECOVERY</span><h1 style={{fontSize:28,margin:'5px 0 6px'}}>Reset Workflow Pay Run</h1><p style={{color:'var(--text3)',fontSize:13}}>Recovery terkontrol untuk Pay Run yang berhenti sebelum payment. Payroll snapshot tetap dipertahankan.</p></div>
    <section className="card" style={{padding:18,display:'grid',gap:14}}>
      <label style={{display:'grid',gap:6,fontSize:12,fontWeight:700}}>Pay Run
        <select value={selected} disabled={loading||busy} onChange={(e)=>setSelected(e.target.value)} style={{padding:11,borderRadius:9,border:'1px solid var(--border)',background:'var(--bg-surface)',color:'var(--text)'}}>
          <option value="">Pilih Pay Run</option>{rows.map((row)=><option key={row.id} value={row.id}>{row.client_name} · {row.project_name||'-'} · {row.period} · {row.state}</option>)}
        </select>
      </label>
      {current?<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}><div className="card" style={{padding:12}}><small>Status</small><strong style={{display:'block',marginTop:4}}>{current.state}</strong></div><div className="card" style={{padding:12}}><small>Payroll lines</small><strong style={{display:'block',marginTop:4}}>{Number(current.payroll_lines||0)}</strong></div><div className="card" style={{padding:12}}><small>Active PI</small><strong style={{display:'block',marginTop:4}}>{Number(current.active_pi_count||0)}</strong></div></div>:null}
      <label style={{display:'grid',gap:6,fontSize:12,fontWeight:700}}>Alasan reset
        <textarea value={reason} maxLength={500} rows={3} onChange={(e)=>setReason(e.target.value)} style={{padding:11,borderRadius:9,border:'1px solid var(--border)',background:'var(--bg-surface)',color:'var(--text)'}}/>
      </label>
      <div style={{padding:12,borderRadius:10,background:'var(--bg-subtle)',fontSize:12,lineHeight:1.6}}>Reset hanya diperbolehkan jika belum ada payment proof, reconciliation, invoice, atau PI pada tahap finansial lanjut. PI awal akan ditandai <b>REJECTED</b>; Pay Run kembali ke <b>CONTROLLER_REVIEW</b>.</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><a className="btn" href="/?view=operations">Kembali ke Pay Runs</a><button className="btn btn-primary" disabled={!selected||reason.trim().length<10||busy} onClick={()=>void reset()}>{busy?'Memproses…':'Reset Pay Run Workflow'}</button></div>
      {message?<div className="app-notice-bubble app-notice-info" role="status"><strong>Status recovery</strong><span>{message}</span></div>:null}
    </section>
  </main>;
}
