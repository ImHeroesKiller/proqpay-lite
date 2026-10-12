'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatIDR } from '@/lib/format';

type Actor={role:string;email?:string;permissions?:string[]};
type Source={id:string;client_id?:string;client_name?:string;project_id?:string;document_no?:string;expected_total?:number;status?:string;payroll_period?:string;payment_period?:string};
type DR={id:string;clientId:string;projectId?:string|null;purpose:'PAYROLL'|'EWA';destinationMode:'DIRECT_EMPLOYEE'|'CLIENT_ACCOUNT';sourceDocumentType:'PAYMENT_INSTRUCTION'|'EWA_REQUEST';sourceDocumentId:string;status:string;provider:string;environment:string;providerSubAccountIdMasked?:string;providerChannel?:{providerChannel?:string;intentKey?:string}|null;amount:number;recipientCount:number;clientReference:string;requestedBy?:string|null;items?:Array<{id:string;beneficiaryName:string;bankCode:string;accountLast4:string;amount:number}>};
type Props={actor:Actor|null;payrollSources?:Source[];clientId?:string;projectId?:string;sourceType?:'PAYMENT_INSTRUCTION'|'EWA_REQUEST';focusSourceId?:string;onChanged?:()=>void};

async function api(path:string,payload?:Record<string,unknown>){
  const response=await fetch(path,{method:payload?'POST':'GET',headers:payload?{'Content-Type':'application/json'}:{Accept:'application/json'},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(String(body.error||`HTTP ${response.status}`));(error as Error&{code?:string}).code=body.code;throw error;}
  return body;
}

export default function CanonicalDisbursementWorkspace({actor,payrollSources=[],clientId='',projectId='',sourceType,focusSourceId='',onChanged}:Props){
  const [requests,setRequests]=useState<DR[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const [sourceId,setSourceId]=useState(focusSourceId);
  const [destination,setDestination]=useState<'DIRECT_EMPLOYEE'|'CLIENT_ACCOUNT'>('DIRECT_EMPLOYEE');
  const [selected,setSelected]=useState<DR|null>(null);
  const [reason,setReason]=useState('');
  const [refreshKey,setRefreshKey]=useState(0);
  const allowed=actor&&['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(actor.role);
  const maker=actor?.role==='PAYROLL_PROCESSOR'&&Boolean(actor.permissions?.includes('disbursement:request'));
  const checker=actor?.role==='PAYROLL_CONTROLLER'&&Boolean(actor.permissions?.includes('disbursement:approve'));
  const executor=actor?.role==='PAYROLL_CONTROLLER'; // gateway:execute is a role capability, not session permissions
  const canReconcile=actor?.role==='PAYROLL_CONTROLLER'&&Boolean(actor.permissions?.includes('reconciliation:write'));
  const availableSources=useMemo(()=>payrollSources.filter(p=>['PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT'].includes(String(p.status))
    &&(!clientId||clientId==='ALL'||p.client_id===clientId)&&(!projectId||projectId==='ALL'||p.project_id===projectId)),[payrollSources,clientId,projectId]);
  const load=useCallback(async()=>{
    if(!allowed){setLoading(false);return;}
    setLoading(true);
    try{
      const search=new URLSearchParams();if(clientId&&clientId!=='ALL')search.set('clientId',clientId);
      if(sourceType&&focusSourceId){search.set('sourceDocumentType',sourceType);search.set('sourceDocumentId',focusSourceId);}
      const body=await api(`/api/disbursement-requests?${search.toString()}`);
      setRequests((body.requests||[]) as DR[]);
    }catch(error){setNotice(error instanceof Error?error.message:'Canonical DR tidak dapat dimuat');}
    finally{setLoading(false);}
  },[allowed,clientId,sourceType,focusSourceId]);
  useEffect(()=>{void load();},[load,refreshKey]);
  useEffect(()=>{setSourceId(focusSourceId);},[focusSourceId]);
  const visible=useMemo(()=>requests.filter(row=>(!sourceType||row.sourceDocumentType===sourceType)
    &&(!projectId||projectId==='ALL'||row.projectId===projectId)
    &&(!focusSourceId||row.sourceDocumentId===focusSourceId)),[requests,sourceType,projectId,focusSourceId]);
  const existingForSource=sourceId?requests.find(row=>row.sourceDocumentId===sourceId&&row.sourceDocumentType===(sourceType||'PAYMENT_INSTRUCTION')&& !['REJECTED','CANCELLED'].includes(row.status)):null;
  async function openDetail(id:string){
    setBusy(`DETAIL:${id}`);try{const body=await api(`/api/disbursement-requests?id=${encodeURIComponent(id)}`);setSelected(body.request);}
    catch(error){setNotice(error instanceof Error?error.message:'Gagal memuat detail DR');}finally{setBusy('');}
  }
  async function run(key:string,payload:Record<string,unknown>,message:string){
    if(busy)return;
    setBusy(key);setNotice('');
    try{
      const target=key==='EXECUTE'?'/api/disbursement-executions':key==='RECONCILE'?'/api/canonical-transaction-register':'/api/disbursement-requests';
      const body=await api(target,payload);
      if(body.request?.id){setSelected(body.request);}
      setNotice(message);
      await load();onChanged?.();setRefreshKey(v=>v+1);
    }catch(error){
      const code=(error as Error&{code?:string}).code;
      const description=error instanceof Error?error.message:'Aksi gagal';
      setNotice(code==='MFA_STEP_UP_REQUIRED'?`${description} Silakan login ulang dengan Google Authenticator aktif untuk memperbarui MFA. Tidak perlu reset MFA.`:`${description}${code?` [${code}]`:''}`);
    }finally{setBusy('');}
  }
  async function create(){
    if(!sourceId||!maker)return;
    const kind=sourceType||'PAYMENT_INSTRUCTION';
    if(!window.confirm(`Buat Canonical DR untuk ${kind==='EWA_REQUEST'?'EWA':'Payroll'} ${sourceId}? Nominal dan rekening akan diambil dari snapshot backend, tidak dapat diubah dari UI.`))return;
    await run('CREATE',{action:'CREATE',sourceDocumentType:kind,sourceDocumentId:sourceId,destinationMode:kind==='EWA_REQUEST'?'DIRECT_EMPLOYEE':destination},'Canonical Disbursement Request dibuat. Lanjutkan submit ke Controller.');
  }
  async function execute(row:DR){
    if(!executor)return;
    const confirmation=window.prompt(`KONFIRMASI PEMBAYARAN RIIL melalui E2Pay\n${row.clientReference}\n${formatIDR(row.amount)} · ${row.recipientCount} penerima\n${row.providerSubAccountIdMasked||''}\n\nKetik BAYAR untuk mengeksekusi transaksi yang telah disetujui Controller:`);
    if(confirmation!=='BAYAR')return;
    await run('EXECUTE',{action:'EXECUTE',disbursementRequestId:row.id},'Execution dijalankan; tinjau status provider, lakukan reconciliation untuk status ambigu.');
  }
  const ready=visible.filter(r=>r.status==='READY').length;
  const pending=visible.filter(r=>r.status==='PENDING_APPROVAL').length;
  const executionQueue=visible.filter(r=>r.status==='APPROVED').length;
  if(!allowed)return null;
  return <section className="card" style={{padding:16,display:'grid',gap:14}} aria-label="Canonical Disbursement Control">
    <div style={{display:'flex',gap:12,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}>
      <div><span className="page-eyebrow">CANONICAL PAYMENT CONTROL · P0.B</span><h3 style={{margin:'4px 0'}}>Disbursement Request & Execution</h3><small style={{color:'var(--text3)'}}>Payroll Direct · Payroll Corporate · EWA Direct — satu approval, funding, dan provider reconciliation.</small></div>
      <button className="btn" type="button" disabled={loading||Boolean(busy)} onClick={()=>void load()}>Refresh status</button>
    </div>
    <div className="directory-detail-grid"><div><span>Ready to submit</span><strong>{ready}</strong></div><div><span>Waiting Controller</span><strong>{pending}</strong></div><div><span>Approved to execute</span><strong>{executionQueue}</strong></div></div>
    {maker?<div style={{display:'flex',gap:10,alignItems:'end',flexWrap:'wrap'}}>
      {sourceType==='EWA_REQUEST'?<label style={{flex:'1 1 220px'}}>EWA Request<input value={sourceId} readOnly placeholder="Pilih pengajuan EWA yang APPROVED"/></label>
      :<label style={{flex:'2 1 260px'}}>Payment Instruction<select value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">Pilih PI siap pembayaran</option>{availableSources.map(row=><option key={row.id} value={row.id}>{row.document_no||row.id} · {row.client_name||row.client_id} · {formatIDR(Number(row.expected_total||0))}</option>)}</select></label>}
      {sourceType!=='EWA_REQUEST'?<label style={{flex:'1 1 210px'}}>Tujuan pembayaran<select value={destination} disabled={Boolean(existingForSource)} onChange={e=>setDestination(e.target.value as typeof destination)}><option value="DIRECT_EMPLOYEE">Ke rekening karyawan</option><option value="CLIENT_ACCOUNT">Ke rekening perusahaan klien</option></select></label>:null}
      <button type="button" className="btn btn-primary" disabled={!sourceId||Boolean(busy)||Boolean(existingForSource)} onClick={()=>void create()}>{existingForSource?'DR sudah dibuat':'Buat Canonical DR'}</button>
    </div>:null}
    {notice?<div className={`app-notice-bubble ${/gagal|tidak|blocked|wajib|invalid|mismatch|belum|ditolak/i.test(notice)?'app-notice-error':'app-notice-info'}`} role="status"><span>{notice}</span></div>:null}
    {loading?<p>Memuat Canonical DR…</p>:visible.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Source & Reference</th><th>Intent</th><th>Nominal</th><th>Status</th><th>Next action</th></tr></thead><tbody>{visible.map(row=><tr key={row.id}>
      <td><strong>{row.clientReference}</strong><small style={{display:'block'}}>{row.sourceDocumentType==='EWA_REQUEST'?'EWA':'PI'} · {row.sourceDocumentId}</small><small>{row.provider} {row.providerSubAccountIdMasked}</small></td>
      <td>{row.purpose}<small style={{display:'block'}}>{row.destinationMode==='CLIENT_ACCOUNT'?'Corporate settlement':'Employee direct'}</small></td>
      <td><strong>{formatIDR(row.amount)}</strong><small style={{display:'block'}}>{row.recipientCount} recipient</small></td>
      <td><strong>{row.status.replaceAll('_',' ')}</strong></td>
      <td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <button className="btn" type="button" disabled={Boolean(busy)} onClick={()=>void openDetail(row.id)}>Review snapshot</button>
        {maker&&row.status==='READY'?<button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void run('SUBMIT',{action:'SUBMIT_REQUEST',id:row.id},'DR dikirim ke Payroll Controller.')}>Submit</button>:null}
        {checker&&row.status==='PENDING_APPROVAL'?<><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void openDetail(row.id)}>Review & Approve</button></>:null}
        {executor&&row.status==='APPROVED'?<button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void execute(row)}>Process Payment</button>:null}
        {canReconcile&&['RECONCILIATION_REQUIRED','PROCESSING','PARTIALLY_SETTLED','FAILED','SETTLED'].includes(row.status)?<button type="button" className="btn" disabled={Boolean(busy)} onClick={()=>void run('RECONCILE',{action:'RECONCILE',disbursementRequestId:row.id},'Provider reconciliation dijalankan.')}>Reconcile</button>:null}
      </div></td>
    </tr>)}</tbody></table></div>:<p style={{margin:0,color:'var(--text3)'}}>Belum ada Canonical DR pada filter ini. {maker?'Pilih PI / EWA yang telah siap untuk dibuatkan DR.':'Menunggu Payroll Processor membuat dan mengirim request.'}</p>}
    {selected?<div className="card" style={{padding:14,display:'grid',gap:10}} aria-label="Immutable Disbursement Snapshot">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><strong>Snapshot · {selected.clientReference}</strong><button type="button" className="btn" onClick={()=>setSelected(null)}>Tutup detail</button></div>
      <p style={{margin:0}}>Sumber: {selected.sourceDocumentId} · {selected.purpose}/{selected.destinationMode} · {formatIDR(selected.amount)} · {selected.status}</p>
      <p style={{margin:0,fontSize:12}}>Provider: {selected.provider} · {selected.environment} · {selected.providerSubAccountIdMasked} · Channel: {selected.providerChannel?.providerChannel||'BELUM TERKONFIRMASI'}</p>
      <div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Penerima</th><th>Bank</th><th>Rekening</th><th>Nominal</th></tr></thead><tbody>{(selected.items||[]).map(item=><tr key={item.id}><td>{item.beneficiaryName}</td><td>{item.bankCode}</td><td>••••{item.accountLast4}</td><td>{formatIDR(item.amount)}</td></tr>)}</tbody></table></div>
      {checker&&selected.status==='PENDING_APPROVAL'?<div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end'}}><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>{if(window.confirm(`Setujui DR ${selected.clientReference} sebesar ${formatIDR(selected.amount)}? Approval membutuhkan MFA terbaru dan funding READY.`))void run('APPROVE',{action:'APPROVE_REQUEST',id:selected.id},'Disbursement Request disetujui oleh Controller.');}}>Approve DR</button><label style={{flex:'1 1 230px'}}>Alasan penolakan<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} placeholder="Minimal 10 karakter"/></label><button type="button" className="btn" disabled={reason.trim().length<10||Boolean(busy)} onClick={()=>void run('REJECT',{action:'REJECT_REQUEST',id:selected.id,reason},'Disbursement Request ditolak.')}>Reject DR</button></div>:null}
    </div>:null}
    <small style={{color:'var(--text3)'}}>Transfer riil tidak pernah dijalankan otomatis. Hanya Payroll Controller yang bisa menekan Process Payment setelah approval, verifikasi MFA, limit, dan liquidity.</small>
  </section>;
}
