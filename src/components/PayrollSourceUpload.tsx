'use client';

import { useEffect, useMemo, useState } from 'react';
import { listOperatingResource } from '@/lib/operating-model-api';
import { downloadPayrollTemplate, PAYROLL_TEMPLATE_VERSION } from '@/lib/payroll-template';
import type { ParsedEmployee } from '@/lib/excel-iap';
import { formatIDR } from '@/lib/format';

type Submission = {
  id:string; client_id:string; client_name?:string; project_id?:string; project_name?:string;
  service_plan_id:string; service_tier:string; period:string; source_mode:string; state:string; period_status?:string;
};

export default function PayrollSourceUpload() {
  const [submissions,setSubmissions] = useState<Submission[]>([]);
  const [submissionId,setSubmissionId] = useState('');
  const [file,setFile] = useState<File|null>(null);
  const [rows,setRows] = useState<ParsedEmployee[]>([]);
  const [meta,setMeta] = useState<{sheetName:string;totalRaw:number;skipped:number}|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');

  useEffect(()=>{void (async()=>{
    try {
      const meResponse=await fetch('/api/me'); const me=await meResponse.json();
      if(!meResponse.ok) throw new Error(me.error||`HTTP ${meResponse.status}`);
      const clientIds=me.user?.role==='CLIENT_USER'?(me.user.clientIds||[]):[undefined];
      const results=await Promise.all(clientIds.map((clientId:string|undefined)=>listOperatingResource('submissions',clientId)));
      const merged=results.flatMap((result:any)=>result.submissions||[]);
      const eligible=[...new Map(merged.map((row:Submission)=>[row.id,row])).values()]
        .filter((row:Submission)=>row.source_mode==='UPLOAD_FINAL'&&row.state==='DRAFT'&&row.period_status!=='CLOSED');
      setSubmissions(eligible as Submission[]);
    } catch(cause){setMessage(cause instanceof Error?cause.message:'Gagal memuat Pay Run');}
  })();},[]);

  const selected=useMemo(()=>submissions.find((row)=>row.id===submissionId)||null,[submissions,submissionId]);
  const totals=useMemo(()=>rows.reduce((sum,row)=>({gross:sum.gross+Number(row.grossPay||0),deduction:sum.deduction+Number(row.totalDeductions||0),net:sum.net+Number(row.netPay||0)}),{gross:0,deduction:0,net:0}),[rows]);
  const balanced=rows.length>0&&totals.gross-totals.deduction===totals.net;

  async function choose(next:File){
    setBusy(true);setMessage('');setFile(null);setRows([]);
    try{
      if(next.size>8*1024*1024)throw new Error('Ukuran file maksimal 8 MB');
      const {parseIapWorkbook}=await import('@/lib/excel-iap');
      const parsed=await parseIapWorkbook(await next.arrayBuffer());
      if(!parsed.rows.length)throw new Error('Tidak ada baris payroll valid');
      setFile(next);setRows(parsed.rows);setMeta({sheetName:parsed.sheetName,totalRaw:parsed.totalRaw,skipped:parsed.skipped});
    }catch(cause){setMessage(cause instanceof Error?cause.message:'File tidak dapat dibaca');}
    finally{setBusy(false);}
  }

  async function upload(){
    if(!selected||!file||!rows.length)return;
    if(!balanced){setMessage('Control total tidak balance: Gross - Potongan harus sama dengan Net/THP.');return;}
    setBusy(true);setMessage('');
    try{
      const form=new FormData();
      form.set('file',file);
      form.set('rows',JSON.stringify(rows));
      form.set('context',JSON.stringify({submissionId:selected.id,clientId:selected.client_id,projectId:selected.project_id||null,servicePlanId:selected.service_plan_id,tier:selected.service_tier,period:selected.period}));
      form.set('sourceSheet',meta?.sheetName||'01_PAYROLL_DATA');
      form.set('rawRowCount',String(meta?.totalRaw||rows.length));
      form.set('templateVersion',PAYROLL_TEMPLATE_VERSION);
      const response=await fetch('/api/payroll-upload',{method:'POST',body:form});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload.error)throw new Error(payload.error||`HTTP ${response.status}`);
      setMessage(`Source payroll tersimpan immutable. Batch ${payload.batchId} · SHA-256 ${String(payload.fileSha256||'').slice(0,16)}… · ${rows.length} karyawan.`);
      setFile(null);setRows([]);setMeta(null);setSubmissionId('');
      setSubmissions((current)=>current.filter((row)=>row.id!==selected.id));
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Upload payroll gagal');}
    finally{setBusy(false);}
  }

  return <div className="card" style={{padding:18,marginBottom:16}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div><span className="workspace-eyebrow">PAYROLL SOURCE CONTROL</span><h3 style={{margin:'4px 0'}}>Upload Payroll Final</h3><p style={{fontSize:12,color:'var(--text3)',margin:0}}>File asli disimpan private di R2, diberi SHA-256, row hash dan control total sebelum menjadi canonical payroll snapshot.</p></div>
      <button type="button" className="btn" onClick={()=>void downloadPayrollTemplate()}>Unduh Template v1</button>
    </div>
    <div className="directory-form-grid" style={{marginTop:14}}>
      <label>Pay Run UPLOAD_FINAL<select value={submissionId} onChange={(event)=>setSubmissionId(event.target.value)}><option value="">Pilih Pay Run</option>{submissions.map((row)=><option key={row.id} value={row.id}>{row.period} · {row.client_name||row.client_id} · {row.project_name||row.project_id||'-'}</option>)}</select></label>
      <label>File Excel<input type="file" accept=".xlsx" disabled={!selected||busy} onChange={(event)=>{const next=event.target.files?.[0];if(next)void choose(next);event.target.value='';}} /></label>
    </div>
    {file&&<div className="payroll-review-totals" style={{marginTop:12}}><div><span>File</span><strong>{file.name}</strong><small>{rows.length} accepted · {meta?.skipped||0} skipped</small></div><div><span>Gross</span><strong>{formatIDR(totals.gross)}</strong></div><div><span>Potongan</span><strong>{formatIDR(totals.deduction)}</strong></div><div><span>Net/THP</span><strong>{formatIDR(totals.net)}</strong><small>{balanced?'BALANCED':'NOT BALANCED'}</small></div></div>}
    {file&&<button type="button" className="btn btn-primary" disabled={busy||!balanced} onClick={()=>void upload()} style={{marginTop:12}}>{busy?'Menyimpan source…':'Validasi & Import Payroll Final'}</button>}
    {message&&<div className={`app-notice-bubble ${/gagal|tidak|error|invalid/i.test(message)?'app-notice-error':'app-notice-info'}`} style={{marginTop:12}}><strong>Payroll source</strong><span>{message}</span></div>}
  </div>;
}
