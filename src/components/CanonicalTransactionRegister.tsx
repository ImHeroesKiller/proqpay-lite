'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import E2PaySupportJson from '@/components/E2PaySupportJson';
import {formatIDR} from '@/lib/format';
import {Notice as UiNotice,StatusBadge as UiStatusBadge} from '@/components/ui/UnifiedSystem';
import LegacyTransactionHistory from '@/components/LegacyTransactionHistory';

type Actor={role:string;permissions?:string[]};
type Tx={disbursementRequestId:string;clientId:string;projectId?:string|null;purpose:string;destinationMode:string;beneficiaryType:string;sourceDocumentType:string;sourceDocumentId:string;provider:string;providerSubAccountIdMasked?:string|null;providerChannel?:string|null;clientReference:string;amount:number;currency:string;recipientCount:number;status:string;executionStatus?:string|null;reconciliationStatus?:string|null;succeededItems:number;failedItems:number;unresolvedItems:number;settledAmount:number;failedAmount:number;requestedBy?:string|null;approvedBy?:string|null;createdAt:string;lastReconciledAt?:string|null};
type Attempt={id:string;status:string;total_items:number;succeeded_items:number;failed_items:number;unresolved_items:number;settled_amount:number;failed_amount:number;provider_found_count:number;provider_missing_count:number;created_at:string;error_code?:string|null};
type Item={id:string;client_ref:string;beneficiary_name:string;bank_code:string;account_last4:string;amount:number;status:string;provider_transaction_id?:string|null;error_code?:string|null};
type Detail={register:Tx;items:Item[];reconciliationAttempts:Attempt[]};
type Pagination={page:number;pageSize:number;total:number;totalPages:number;hasNext:boolean};
const tone=(status:string)=>status==='RECONCILED'||status==='SETTLED'||status==='MATCHED'?'success':status==='FAILED'||status==='RECONCILIATION_REQUIRED'?'warning':'neutral';

export default function CanonicalTransactionRegister({actor,clientId='',projectId='',period='',query=''}:{actor:Actor|null;clientId?:string;projectId?:string;period?:string;query?:string}){
  const [archiveOpen,setArchiveOpen]=useState(false);
  const [rows,setRows]=useState<Tx[]>([]);
  const [pagination,setPagination]=useState<Pagination>({page:1,pageSize:40,total:0,totalPages:1,hasNext:false});
  const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState('');
  const [message,setMessage]=useState('');
  const [purpose,setPurpose]=useState('ALL');
  const [status,setStatus]=useState('ALL');
  const [reconciliationStatus,setReconciliationStatus]=useState('ALL');
  const [detail,setDetail]=useState<Detail|null>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [refreshKey,setRefreshKey]=useState(0);
  const canReconcile=actor?.role==='PAYROLL_CONTROLLER'&&Boolean(actor?.permissions?.includes('reconciliation:write'));
  useEffect(()=>{setPage(1);setDetail(null);},[clientId,projectId,period,query,purpose,status,reconciliationStatus]);

  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setMessage('');
    try{
      const params=new URLSearchParams({page:String(page),pageSize:'40'});
      if(clientId)params.set('clientId',clientId);
      if(projectId)params.set('projectId',projectId);
      if(period)params.set('period',period);
      if(query.trim())params.set('query',query.trim());
      if(purpose!=='ALL')params.set('purpose',purpose);
      if(status!=='ALL')params.set('status',status);
      if(reconciliationStatus!=='ALL')params.set('reconciliationStatus',reconciliationStatus);
      const response=await fetch(`/api/canonical-transaction-register?${params}`,{headers:{Accept:'application/json'},cache:'no-store',signal});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);
      if(signal?.aborted)return;
      setRows(body.transactions||[]);
      setPagination(body.pagination||{page,pageSize:40,total:0,totalPages:1,hasNext:false});
    }catch(error){if(signal?.aborted)return;setRows([]);setPagination({page,pageSize:40,total:0,totalPages:1,hasNext:false});setMessage(error instanceof Error?error.message:'Gagal memuat canonical transaction register');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[clientId,projectId,period,query,purpose,status,reconciliationStatus,page]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return ()=>controller.abort();},[load,refreshKey]);
  async function openDetail(id:string){
    setDetailLoading(true);setMessage('');
    try{
      const response=await fetch(`/api/canonical-transaction-register?id=${encodeURIComponent(id)}`,{cache:'no-store'});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);
      setDetail({register:body.register,items:body.items||[],reconciliationAttempts:body.reconciliationAttempts||[]});
    }catch(error){setMessage(error instanceof Error?error.message:'Detail register tidak tersedia');}
    finally{setDetailLoading(false);}
  }
  async function reconcile(id:string){
    if(!canReconcile||!window.confirm('Jalankan provider history reconciliation untuk transaksi ini? Tidak ada retry transfer otomatis.'))return;
    setBusyId(id);setMessage('');
    try{
      const response=await fetch('/api/canonical-transaction-register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'RECONCILE',disbursementRequestId:id})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);
      setMessage(`Reconciliation ${body.outcome?.attemptStatus||'selesai'} · ${body.summary?.succeeded||0}/${body.summary?.total||0} settled.`);
      setDetail(body.register?{register:body.register,items:body.items||[],reconciliationAttempts:body.reconciliationAttempts||[]}:null);
      setRefreshKey(x=>x+1);
    }catch(error){setMessage(error instanceof Error?error.message:'Reconciliation gagal');}
    finally{setBusyId('');}
  }
  const totals=useMemo(()=>({amount:rows.reduce((s,r)=>s+Number(r.amount||0),0),settled:rows.reduce((s,r)=>s+Number(r.settledAmount||0),0),unresolved:rows.reduce((s,r)=>s+Number(r.unresolvedItems||0),0)}),[rows]);
  return <><section className="ui-section-card canonical-register-workspace">
    <div className="ui-section-card-head"><div><span>CANONICAL REGISTER · AUDITABLE PROVIDER HISTORY</span><h2>Disbursement Transaction Register</h2><small>Payroll Direct · Corporate · EWA. Jumlah transaksi dan pagination berasal dari server, bukan hanya 300 data pertama.</small></div></div>
    <div className="directory-detail-grid"><div><span>Total sesuai filter</span><strong>{loading?'—':pagination.total}</strong></div><div><span>Nilai halaman ini</span><strong>{formatIDR(totals.amount)}</strong></div><div><span>Settled halaman ini</span><strong>{formatIDR(totals.settled)}</strong></div><div><span>Unresolved halaman ini</span><strong>{totals.unresolved}</strong></div></div>
    <div className="ui-filter-bar"><label>Purpose<select value={purpose} onChange={event=>setPurpose(event.target.value)}><option value="ALL">Semua</option><option value="PAYROLL">Payroll</option><option value="EWA">EWA</option></select></label><label>Status<select value={status} onChange={event=>setStatus(event.target.value)}><option value="ALL">Semua</option>{['PENDING_APPROVAL','APPROVED','PROCESSING','RECONCILIATION_REQUIRED','PARTIALLY_SETTLED','RECONCILED','SETTLED','FAILED'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label><label>Reconciliation<select value={reconciliationStatus} onChange={event=>setReconciliationStatus(event.target.value)}><option value="ALL">Semua</option>{['NOT_RECONCILED','PENDING','MATCHED','PARTIAL','FAILED','ERROR'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label><button className="btn" type="button" disabled={loading} onClick={()=>setRefreshKey(v=>v+1)}>Refresh</button></div>
    {message?<UiNotice tone={/gagal|error|diblock|blocked|tidak/i.test(message)?'warning':'info'} title="Transaction Register">{message}</UiNotice>:null}
    {loading?<p>Memuat canonical register…</p>:rows.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Reference</th><th>Intent</th><th>Provider</th><th>Amount</th><th>Recipients</th><th>Status</th><th>Reconciliation</th><th>Aksi</th></tr></thead><tbody>{rows.map(row=><tr key={row.disbursementRequestId}><td><strong>{row.clientReference}</strong><br/><small>{row.sourceDocumentType} · {row.sourceDocumentId}</small></td><td>{row.purpose}<br/><small>{row.destinationMode.replaceAll('_',' ')}</small></td><td>{row.provider}<br/><small>{row.providerChannel||'Not confirmed'} · {row.providerSubAccountIdMasked||'-'}</small></td><td>{formatIDR(row.amount)}<br/><small>Settled {formatIDR(row.settledAmount)}</small></td><td>{row.recipientCount}<br/><small>{row.succeededItems} success · {row.failedItems} failed · {row.unresolvedItems} pending</small></td><td><UiStatusBadge tone={tone(row.status)}>{row.status}</UiStatusBadge></td><td>{row.reconciliationStatus||'NOT_RECONCILED'}<br/><small>{row.lastReconciledAt?new Date(row.lastReconciledAt).toLocaleString('id-ID'):'-'}</small></td><td><div className="canonical-register-actions"><button type="button" className="btn" disabled={detailLoading} onClick={()=>void openDetail(row.disbursementRequestId)}>Detail</button>{canReconcile&&['RECONCILIATION_REQUIRED','PROCESSING','FAILED'].includes(row.status)?<button type="button" className="btn btn-primary" disabled={Boolean(busyId)} onClick={()=>void reconcile(row.disbursementRequestId)}>{busyId===row.disbursementRequestId?'Reconciling…':'Reconcile Provider'}</button>:null}</div></td></tr>)}</tbody></table></div>:<UiNotice tone="info" title="Belum ada transaksi pada filter ini">Ganti filter untuk mencari transaksi lain; canonical DR yang dieksekusi muncul di sini.</UiNotice>}
    <div className="canonical-register-pagination"><span>Halaman {pagination.page} / {pagination.totalPages} · {pagination.total} transaksi terfilter</span><div><button type="button" className="btn" disabled={loading||page<=1} onClick={()=>setPage(v=>v-1)}>Sebelumnya</button><button type="button" className="btn" disabled={loading||!pagination.hasNext} onClick={()=>setPage(v=>v+1)}>Berikutnya</button></div></div>
    {detail?<section className="canonical-register-detail" aria-label="Canonical Transaction Audit Detail"><div className="canonical-register-detail-heading"><div><strong>{detail.register.clientReference}</strong><small>{detail.register.status} · {detail.register.provider} · {detail.register.providerSubAccountIdMasked||''}</small></div><button type="button" className="btn" onClick={()=>setDetail(null)}>Tutup detail</button></div><div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Beneficiary</th><th>Client reference</th><th>Rekening</th><th>Amount</th><th>Provider result</th></tr></thead><tbody>{detail.items.map(item=><tr key={item.id}><td>{item.beneficiary_name}</td><td>{item.client_ref}</td><td>{item.bank_code} · ••••{item.account_last4}</td><td>{formatIDR(Number(item.amount))}</td><td>{item.status} · {item.provider_transaction_id||item.error_code||'—'}</td></tr>)}</tbody></table></div><strong>Provider reconciliation audit trail</strong>{detail.reconciliationAttempts.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Waktu</th><th>Status</th><th>Found / Missing</th><th>Settled / Failed</th></tr></thead><tbody>{detail.reconciliationAttempts.map(attempt=><tr key={attempt.id}><td>{attempt.created_at}</td><td>{attempt.status}{attempt.error_code?` · ${attempt.error_code}`:''}</td><td>{attempt.provider_found_count} / {attempt.provider_missing_count}</td><td>{attempt.succeeded_items} / {attempt.failed_items}</td></tr>)}</tbody></table></div>:<p>Belum ada percobaan reconciliation.</p>}<E2PaySupportJson key={detail.register.disbursementRequestId} requestId={detail.register.disbursementRequestId}/></section>:null}
  </section><details className="gateway-archive-disclosure" onToggle={event=>setArchiveOpen(event.currentTarget.open)}><summary>Histori gateway lama (arsip read-only)</summary>{archiveOpen?<LegacyTransactionHistory clientId={clientId} projectId={projectId} period={period} query={query}/>:null}</details></>;
}
