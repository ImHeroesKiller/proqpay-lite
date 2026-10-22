'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatIDR } from '@/lib/format';
import { fetchWithSecurityStepUp } from '@/lib/security-step-up';
import { refreshE2PayMasterBalance } from '@/lib/e2pay-api';
import { parseApiResponse } from '@/lib/api-client';
import { invalidateOperatingCache } from '@/lib/operating-model-api';
import {canonicalActionRank,canonicalNeedsAction} from '@/lib/payment-decision-workbench';

type Actor={role:string;email?:string;permissions?:string[]};
type Source={id:string;client_id?:string;client_name?:string;project_id?:string;document_no?:string;expected_total?:number;status?:string;payroll_period?:string;payment_period?:string};
type DR={id:string;clientId:string;projectId?:string|null;purpose:'PAYROLL'|'EWA';destinationMode:'DIRECT_EMPLOYEE'|'CLIENT_ACCOUNT';sourceDocumentType:'PAYMENT_INSTRUCTION'|'EWA_REQUEST';sourceDocumentId:string;status:string;provider:string;environment:string;providerSubAccountIdMasked?:string;providerChannel?:{providerChannel?:string;intentKey?:string}|null;amount:number;recipientCount:number;clientReference:string;requestedBy?:string|null;items?:Array<{id:string;beneficiaryName:string;bankCode:string;accountLast4:string;amount:number}>};
type Props={actor:Actor|null;payrollSources?:Source[];clientId?:string;projectId?:string;sourceType?:'PAYMENT_INSTRUCTION'|'EWA_REQUEST';focusSourceId?:string;compact?:boolean;query?:string;onChanged?:()=>void|Promise<void>};

async function api(path:string,payload?:Record<string,unknown>){
  const response=await (payload?fetchWithSecurityStepUp:fetch)(path,{method:payload?'POST':'GET',headers:payload?{'Content-Type':'application/json'}:{Accept:'application/json'},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
  return parseApiResponse<{requests?:DR[];request?:DR;hasMore?:boolean;remaining?:number;phase?:string;parentStatus?:string}>(response);
}

export default function CanonicalDisbursementWorkspace({actor,payrollSources=[],clientId='',projectId='',sourceType,focusSourceId='',compact=false,query='',onChanged}:Props){
  const [requests,setRequests]=useState<DR[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const [sourceId,setSourceId]=useState(focusSourceId);
  const [destination,setDestination]=useState<'DIRECT_EMPLOYEE'|'CLIENT_ACCOUNT'>('DIRECT_EMPLOYEE');
  const [selected,setSelected]=useState<DR|null>(null);
  const [reason,setReason]=useState('');
  const loadGeneration=useRef(0);
  const executionCancelled=useRef(false);
  useEffect(()=>{executionCancelled.current=false;return()=>{executionCancelled.current=true;};},[]);
  const [recipientPage,setRecipientPage]=useState(1);
  const [queueFilter,setQueueFilter]=useState<'ACTION'|'ALL'>('ACTION');
  const allowed=actor&&['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(actor.role);
  const maker=actor?.role==='PAYROLL_PROCESSOR'&&Boolean(actor.permissions?.includes('disbursement:request'));
  const checker=actor?.role==='PAYROLL_CONTROLLER'&&Boolean(actor.permissions?.includes('disbursement:approve'));
  const executor=actor?.role==='PAYROLL_CONTROLLER'; // gateway:execute is a role capability, not session permissions
  const canReconcile=actor?.role==='PAYROLL_CONTROLLER'&&Boolean(actor.permissions?.includes('reconciliation:write'));
  const availableSources=useMemo(()=>payrollSources.filter(p=>['PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT'].includes(String(p.status))
    &&(!clientId||clientId==='ALL'||p.client_id===clientId)&&(!projectId||projectId==='ALL'||p.project_id===projectId)),[payrollSources,clientId,projectId]);
  const load=useCallback(async()=>{
    const generation=++loadGeneration.current;
    if(!allowed){setLoading(false);return;}
    setLoading(true);
    try{
      const search=new URLSearchParams();if(clientId&&clientId!=='ALL')search.set('clientId',clientId);
      if(sourceType&&focusSourceId){search.set('sourceDocumentType',sourceType);search.set('sourceDocumentId',focusSourceId);}
      const body=await api(`/api/disbursement-requests?${search.toString()}`);
      if(generation!==loadGeneration.current)return;
      const rows=body.requests||[];
      setRequests(rows);
      setSelected(previous=>{const fresh=rows.find(row=>row.id===previous?.id);return previous&&fresh?{...previous,...fresh,items:previous.items}:previous;});
    }catch(error){if(generation===loadGeneration.current)setNotice(error instanceof Error?error.message:'Canonical DR tidak dapat dimuat');}
    finally{if(generation===loadGeneration.current)setLoading(false);}
  },[allowed,clientId,sourceType,focusSourceId]);
  useEffect(()=>{void load();return()=>{loadGeneration.current+=1;};},[load]);
  useEffect(()=>{setSourceId(focusSourceId);},[focusSourceId]);
  const visible=useMemo(()=>requests.filter(row=>(!sourceType||row.sourceDocumentType===sourceType)
    &&(!projectId||projectId==='ALL'||row.projectId===projectId)
    &&(!focusSourceId||row.sourceDocumentId===focusSourceId)
    &&(!query.trim()||[row.clientReference,row.sourceDocumentId,row.status,row.purpose,row.destinationMode].join(' ').toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a,b)=>canonicalActionRank(a.status,actor?.role||'')-canonicalActionRank(b.status,actor?.role||'')
      ||a.clientReference.localeCompare(b.clientReference)),[requests,sourceType,projectId,focusSourceId,query,actor?.role]);
  const actionable=visible.filter(row=>canonicalNeedsAction(row.status,actor?.role||''));
  const shown=compact&&queueFilter==='ACTION'?actionable:visible;
  const existingForSource=sourceId?requests.find(row=>row.sourceDocumentId===sourceId&&row.sourceDocumentType===(sourceType||'PAYMENT_INSTRUCTION')&& !['REJECTED','CANCELLED'].includes(row.status)):null;
  async function openDetail(id:string){
    setBusy(`DETAIL:${id}`);try{const body=await api(`/api/disbursement-requests?id=${encodeURIComponent(id)}`);setSelected(body.request||null);setRecipientPage(1);}
    catch(error){setNotice(error instanceof Error?error.message:'Gagal memuat detail DR');}finally{setBusy('');}
  }
  async function run(key:string,payload:Record<string,unknown>,message:string){
    if(busy)return;
    setBusy(key);setNotice('');
    try{
      const target=['EXECUTE','RECOVER_INTERRUPTED'].includes(key)?'/api/disbursement-executions':key==='RECONCILE'?'/api/canonical-transaction-register':'/api/disbursement-requests';
      if(key==='APPROVE'||key==='EXECUTE'){
        const request=requests.find(row=>row.id===(payload.id||payload.disbursementRequestId))||selected;
        if(request?.provider.toUpperCase()==='E2PAY')await refreshE2PayMasterBalance();
      }
      let body=await api(target,payload);
      // Continue only a completed, persisted batch. Never retry a failed request.
      const seen=new Set<string>();
      for(let batch=1;key==='EXECUTE'&&body.hasMore&&batch<100&&!executionCancelled.current;batch++){
        const progress=`${body.phase||'PAYMENT'}:${body.remaining}`;
        if(seen.has(progress))throw new Error('Progres tidak berubah. Proses dihentikan; refresh status sebelum melanjutkan.');
        seen.add(progress);
        setNotice(`Progres tersimpan · ${Number(body.remaining||0).toLocaleString('id-ID')} penerima menunggu ${body.phase==='INQUIRY'?'validasi rekening':'pembayaran'}.`);
        body=await api(target,payload);
      }
      if(body.request?.id){setSelected(body.request||null);setRecipientPage(1);}
      setNotice(body.hasMore?`Progres tersimpan. ${Number(body.remaining||0).toLocaleString('id-ID')} penerima menunggu tahap ${body.phase==='INQUIRY'?'validasi rekening':'pembayaran'} berikutnya. Klik Lanjutkan proses untuk meneruskan.`:message);
      invalidateOperatingCache();
      await load();
      await onChanged?.();
    }catch(error){
      const code=(error as Error&{code?:string}).code;
      const description=error instanceof Error?error.message:'Aksi gagal';
      invalidateOperatingCache();
      await load();
      await onChanged?.();
      setNotice(code==='MFA_STEP_UP_REQUIRED'?'Approval belum disimpan. Verifikasi kode Google Authenticator diperlukan; silakan ulangi approval.':`${description}${code?` [${code}]`:''}`);
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
  return <section className={`canonical-disbursement-workspace${compact?' canonical-disbursement-compact':''}`} aria-label="Canonical Disbursement Control">
    <div className="canonical-disbursement-heading">
      <div><span className="page-eyebrow">CANONICAL PAYMENT CONTROL</span><h3>Disbursement Request & Execution</h3><small>Payroll Direct · Payroll Corporate · EWA Direct — satu approval dan provider reconciliation.</small></div>
      <button className="btn" type="button" disabled={loading||Boolean(busy)} onClick={()=>void load()}>Refresh status</button>
    </div>
    {!compact?<div className="directory-detail-grid"><div><span>Ready to submit</span><strong>{ready}</strong></div><div><span>Waiting Controller</span><strong>{pending}</strong></div><div><span>Approved to execute</span><strong>{executionQueue}</strong></div></div>:<div className="canonical-queue-bar" aria-label="Antrean Canonical DR"><span><strong>{actionable.length}</strong> memerlukan tindakan</span><span>{pending} menunggu Controller</span><span>{executionQueue} approved untuk eksekusi</span><div className="canonical-queue-switch"><button type="button" className={queueFilter==='ACTION'?'active':''} aria-pressed={queueFilter==='ACTION'} onClick={()=>setQueueFilter('ACTION')}>Tindakan saya</button><button type="button" className={queueFilter==='ALL'?'active':''} aria-pressed={queueFilter==='ALL'} onClick={()=>setQueueFilter('ALL')}>Semua status</button></div></div>}
    {maker?<div className="canonical-create-form">
      {sourceType==='EWA_REQUEST'?<label className="ui-form-field">EWA Request<input value={sourceId} readOnly placeholder="Pilih pengajuan EWA yang APPROVED"/></label>
      :<label className="ui-form-field">Payment Instruction<select value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">Pilih PI siap pembayaran</option>{availableSources.map(row=><option key={row.id} value={row.id}>{row.document_no||row.id} · {row.client_name||row.client_id} · {formatIDR(Number(row.expected_total||0))}</option>)}</select></label>}
      {sourceType!=='EWA_REQUEST'?<label className="ui-form-field">Tujuan pembayaran<select value={destination} disabled={Boolean(existingForSource)} onChange={e=>setDestination(e.target.value as typeof destination)}><option value="DIRECT_EMPLOYEE">Ke rekening karyawan</option><option value="CLIENT_ACCOUNT">Ke rekening perusahaan klien</option></select></label>:null}
      <button type="button" className="btn btn-primary" disabled={!sourceId||Boolean(busy)||Boolean(existingForSource)} onClick={()=>void create()}>{existingForSource?'DR sudah dibuat':'Buat Canonical DR'}</button>
    </div>:null}
    {notice?<div className={`app-notice-bubble ${/gagal|tidak|blocked|wajib|invalid|mismatch|belum|ditolak/i.test(notice)?'app-notice-error':'app-notice-info'}`} role="status"><span>{notice}</span></div>:null}
    {loading?<p>Memuat Canonical DR…</p>:shown.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Source & Reference</th><th>Intent</th><th>Nominal</th><th>Status</th><th>Next action</th></tr></thead><tbody>{shown.map(row=><tr key={row.id}>
      <td><strong>{row.clientReference}</strong><small style={{display:'block'}}>{row.sourceDocumentType==='EWA_REQUEST'?'EWA':'PI'} · {row.sourceDocumentId}</small><small>{row.provider} {row.providerSubAccountIdMasked}</small></td>
      <td>{row.purpose}<small style={{display:'block'}}>{row.destinationMode==='CLIENT_ACCOUNT'?'Corporate settlement':'Employee direct'}</small></td>
      <td><strong>{formatIDR(row.amount)}</strong><small style={{display:'block'}}>{row.recipientCount} recipient</small></td>
      <td><strong>{row.status.replaceAll('_',' ')}</strong></td>
      <td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <button className="btn" type="button" disabled={Boolean(busy)} onClick={()=>void openDetail(row.id)}>Review snapshot</button>
        {maker&&row.status==='FAILED'?<button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>{if(window.confirm('Ajukan ulang DR dari PI yang sama? Sistem memverifikasi belum ada transfer, mempertahankan riwayat gagal, dan membuat DR pengganti untuk approval Controller.'))void run('REISSUE',{action:'REISSUE_FAILED',id:row.id},'DR pengganti berhasil dibuat. Klik Submit untuk persetujuan Controller.');}}>Ajukan ulang</button>:null}
        {maker&&row.status==='READY'?<button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void run('SUBMIT',{action:'SUBMIT_REQUEST',id:row.id},'DR dikirim ke Payroll Controller.')}>Submit</button>:null}
        {checker&&row.status==='PENDING_APPROVAL'?<><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void openDetail(row.id)}>Review & Approve</button></>:null}
        {executor&&['APPROVED','PROCESSING'].includes(row.status)?<button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void execute(row)}>{row.status==='PROCESSING'?'Lanjutkan proses':'Process Payment'}</button>:null}
        {executor&&['EXECUTING','PROCESSING'].includes(row.status)?<button type="button" className="btn" disabled={Boolean(busy)} onClick={()=>{if(window.confirm('Periksa dan tutup status eksekusi yang terputus? Tindakan ini tidak mengirim pembayaran. Proses aktif akan ditolak oleh server.'))void run('RECOVER_INTERRUPTED',{action:'RECOVER_INTERRUPTED',disbursementRequestId:row.id},'Status diperbarui. Tinjau kegagalan atau lanjutkan rekonsiliasi.');}}>Pulihkan status</button>:null}
        {canReconcile&&['RECONCILIATION_REQUIRED','PROCESSING','PARTIALLY_SETTLED','FAILED','SETTLED'].includes(row.status)?<button type="button" className="btn" disabled={Boolean(busy)} onClick={()=>void run('RECONCILE',{action:'RECONCILE',disbursementRequestId:row.id},'Provider reconciliation dijalankan.')}>Reconcile</button>:null}
      </div></td>
    </tr>)}</tbody></table></div>:<p style={{margin:0,color:'var(--text3)'}}>{compact&&queueFilter==='ACTION'&&visible.length?'Tidak ada tindakan yang memerlukan keputusan Anda. Pilih Semua status untuk monitoring.':'Belum ada Canonical DR pada filter ini.'} {maker?'Pilih PI / EWA yang telah siap untuk dibuatkan DR.':'Menunggu Payroll Processor membuat dan mengirim request.'}</p>}
    {selected?<div className="canonical-snapshot" aria-label="Immutable Disbursement Snapshot">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><strong>Snapshot · {selected.clientReference}</strong><button type="button" className="btn" onClick={()=>setSelected(null)}>Tutup detail</button></div>
      <p style={{margin:0}}>Sumber: {selected.sourceDocumentId} · {selected.purpose}/{selected.destinationMode} · {formatIDR(selected.amount)} · {selected.status}</p>
      <p style={{margin:0,fontSize:12}}>Provider: {selected.provider} · {selected.environment} · {selected.providerSubAccountIdMasked} · Channel: {selected.providerChannel?.providerChannel||'BELUM TERKONFIRMASI'}</p>
      {checker&&selected.status==='PENDING_APPROVAL'?<div className="canonical-review-actions"><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>{if(window.confirm(`Setujui DR ${selected.clientReference} sebesar ${formatIDR(selected.amount)}? Approval membutuhkan MFA terbaru dan funding READY.`))void run('APPROVE',{action:'APPROVE_REQUEST',id:selected.id},'Disbursement Request disetujui oleh Controller.');}}>Approve DR</button><label className="ui-form-field">Alasan penolakan<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} placeholder="Minimal 10 karakter"/></label><button type="button" className="btn" disabled={reason.trim().length<10||Boolean(busy)} onClick={()=>void run('REJECT',{action:'REJECT_REQUEST',id:selected.id,reason},'Disbursement Request ditolak.')}>Reject DR</button></div>:null}
      <div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Penerima</th><th>Bank</th><th>Rekening</th><th>Nominal</th></tr></thead><tbody>{(selected.items||[]).slice((recipientPage-1)*25,recipientPage*25).map(item=><tr key={item.id}><td>{item.beneficiaryName}</td><td>{item.bankCode}</td><td>••••{item.accountLast4}</td><td>{formatIDR(item.amount)}</td></tr>)}</tbody></table></div>

      {(selected.items?.length||0)>25?<nav className="canonical-recipient-pages" aria-label="Halaman penerima"><span>{(recipientPage-1)*25+1}–{Math.min(recipientPage*25,selected.items?.length||0)} dari {selected.items?.length} penerima</span><button type="button" className="btn" disabled={recipientPage<=1} onClick={()=>setRecipientPage(page=>page-1)}>Sebelumnya</button><button type="button" className="btn" disabled={recipientPage*25>=(selected.items?.length||0)} onClick={()=>setRecipientPage(page=>page+1)}>Berikutnya</button></nav>:null}
    </div>:null}
    <small style={{color:'var(--text3)'}}>Transfer riil tidak pernah dijalankan otomatis. Hanya Payroll Controller yang bisa menekan Process Payment setelah approval, verifikasi MFA, limit, dan liquidity.</small>
  </section>;
}
