'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Summary={status:string;resourceType:string;count:number};
type RecordRow={id:string;resourceType:string;resourceId:string;classification:string;status:string;resolutionStrategy:string;detail:Record<string,unknown>;lastDetectedAt:string;resolvedAt?:string|null};

export default function LegacyCompatibilityPanel(){
  const [summary,setSummary]=useState<Summary[]>([]);
  const [records,setRecords]=useState<RecordRow[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const load=useCallback(async()=>{
    try{
      const response=await fetch('/api/legacy-compatibility',{headers:{Accept:'application/json'},cache:'no-store'});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);
      setSummary(body.summary||[]);setRecords(body.records||[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal memuat legacy compatibility');}
  },[]);
  useEffect(()=>{void load();},[load]);
  async function refresh(){
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/legacy-compatibility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'REFRESH_AUDIT'})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);
      setMessage(`Audit legacy diperbarui · ${body.evaluated||0} record dievaluasi.`);await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Audit legacy gagal');}
    finally{setBusy(false);}
  }
  const totals=useMemo(()=>Object.fromEntries(['RECOVERY_REQUIRED','RETAIN_LEGACY','CANONICAL_ELIGIBLE','RESOLVED'].map(status=>[status,summary.filter(x=>x.status===status).reduce((n,x)=>n+x.count,0)])),[summary]);
  return <div className="card" style={{padding:14,display:'grid',gap:12}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><div><strong style={{fontSize:12}}>P5.7 Legacy Compatibility Closure</strong><div style={{fontSize:11.5,color:'var(--text3)'}}>Tidak mengubah financial state otomatis. In-flight legacy tetap di pipeline lama; account existing dipulihkan tanpa recreate sub-account.</div></div><button type="button" className="btn" disabled={busy} onClick={()=>void refresh()}>{busy?'Mengaudit…':'Refresh Legacy Audit'}</button></div>
    <div className="operations-summary-grid" style={{margin:0}}><div><span>Recovery Required</span><strong>{totals.RECOVERY_REQUIRED||0}</strong></div><div><span>Retain Legacy</span><strong>{totals.RETAIN_LEGACY||0}</strong></div><div><span>Canonical Eligible</span><strong>{totals.CANONICAL_ELIGIBLE||0}</strong></div><div><span>Resolved</span><strong>{totals.RESOLVED||0}</strong></div></div>
    {message?<div className="settings-status info" role="status">{message}</div>:null}
    {records.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Resource</th><th>Classification</th><th>Status</th><th>Strategy</th><th>Safe detail</th></tr></thead><tbody>{records.slice(0,100).map(row=><tr key={row.id}><td>{row.resourceType}<br/><small>{row.resourceId}</small></td><td>{row.classification}</td><td>{row.status}</td><td>{row.resolutionStrategy}</td><td><small>{Object.entries(row.detail||{}).map(([k,v])=>`${k}=${String(v??'-')}`).join(' · ')}</small></td></tr>)}</tbody></table></div>:<small style={{color:'var(--text3)'}}>Belum ada compatibility record. Jalankan Refresh Legacy Audit setelah migration diterapkan.</small>}
  </div>;
}
