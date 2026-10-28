'use client';

import {useEffect,useState} from 'react';
import {parseApiResponse} from '@/lib/api-client';
import {buildE2PaySupportEvidence} from '../../shared/e2pay-support-evidence';

type Ledger = Record<string,unknown>;
type Payload = {request?:Ledger;execution?:Ledger;items?:Ledger[]};

export default function E2PaySupportJson({requestId}:{requestId:string}) {
  const [open,setOpen]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [json,setJson]=useState('');
  const [filename,setFilename]=useState('e2pay-support.json');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState('');
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    setLoading(true);setJson('');setError('');setFeedback('');
    const read=async(path:string)=>{
      const response=await fetch(path,{headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal});
      if(response.status===404&&path.startsWith('/api/disbursement-executions'))throw new Error('Belum ada ledger eksekusi. JSON tersedia setelah proses pembayaran dimulai.');
      return parseApiResponse<Payload>(response);
    };
    void Promise.all([
      read(`/api/disbursement-requests?id=${encodeURIComponent(requestId)}`),
      read(`/api/disbursement-executions?disbursementRequestId=${encodeURIComponent(requestId)}`),
    ]).then(([request,ledger])=>{
      if(controller.signal.aborted)return;
      const evidence=buildE2PaySupportEvidence(request.request,ledger.execution,ledger.items||[]);
      setJson(JSON.stringify(evidence,null,2));
      setFilename(`${String(evidence.clientReference||requestId).replace(/[^a-zA-Z0-9_-]/g,'_')}-e2pay.json`);
    }).catch((cause:unknown)=>{
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'JSON tidak dapat dimuat.');
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[requestId,open,refresh]);
  async function copy(){
    try{await navigator.clipboard.writeText(json);setFeedback('JSON berhasil disalin.');}
    catch{setFeedback('Tidak dapat menyalin otomatis. Pilih teks JSON di bawah atau gunakan Unduh JSON.');}
  }
  function download(){
    const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=filename;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setFeedback('Unduhan JSON disiapkan.');
  }
  return <section aria-label="JSON untuk E2Pay" style={{minWidth:0,display:'grid',gap:10}}>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
      <strong>JSON untuk E2Pay</strong>
      <button type="button" className="btn" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Tutup JSON':'Lihat JSON'}</button>
    </div>
    {open?<>
      <small>Ringkasan ledger eksekusi tersimpan, termasuk referensi dan hasil provider per penerima. Bukan raw HTTP request/response. Rekening hanya ditampilkan 4 digit terakhir.</small>
      {loading?<p role="status">Memuat JSON transaksi…</p>:null}
      {error?<p role="alert">{error}</p>:null}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button type="button" className="btn" disabled={!json||loading} onClick={()=>void copy()}>Salin JSON</button>
        <button type="button" className="btn" disabled={!json||loading} onClick={download}>Unduh JSON</button>
        <button type="button" className="btn" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>{error?'Coba lagi':'Refresh JSON'}</button>
      </div>
      {feedback?<p role="status">{feedback}</p>:null}
      {json?<textarea aria-label="JSON hasil transaksi E2Pay" readOnly value={json} rows={16} spellCheck={false} style={{width:'100%',minWidth:0,maxHeight:420,overflow:'auto',fontFamily:'monospace',fontSize:12}}/>:null}
    </>:null}
  </section>;
}
