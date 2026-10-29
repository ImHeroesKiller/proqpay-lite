'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import DetailDrawer from '@/components/layout/DetailDrawer';
import WorkspaceTable from '@/components/layout/WorkspaceTable';
import ReferenceValue from '@/components/layout/ReferenceValue';
import {patchRoute,routeValue,subscribeRoute} from '@/lib/route-state';
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

export default function CanonicalTransactionRegister({actor,clientId='',projectId='',period='',query='',clientNames={},projectNames={}}:{actor:Actor|null;clientId?:string;projectId?:string;period?:string;query?:string;clientNames?:Record<string,string>;projectNames?:Record<string,string>}){
  const [archiveOpen,setArchiveOpen]=useState(false);
  const [rows,setRows]=useState<Tx[]>([]);
  const [pagination,setPagination]=useState<Pagination>({page:1,pageSize:40,total:0,totalPages:1,hasNext:false});
  const [page,setPage]=useState(()=>Math.max(1,Number(routeValue('registerPage'))||1));
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState('');
  const [message,setMessage]=useState('');
  const [purpose,setPurpose]=useState(()=>routeValue('registerPurpose')||'ALL');
  const [status,setStatus]=useState(()=>routeValue('registerStatus')||'ALL');
  const [reconciliationStatus,setReconciliationStatus]=useState(()=>routeValue('registerReconciliation')||'ALL');
  const [loadError,setLoadError]=useState('');
  const [detail,setDetail]=useState<Detail|null>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [refreshKey,setRefreshKey]=useState(0);
  const canReconcile=actor?.role==='PAYROLL_CONTROLLER'&&Boolean(actor?.permissions?.includes('reconciliation:write'));
  const scope=JSON.stringify([clientId,projectId,period,query,purpose,status,reconciliationStatus]);
  const previousScope=useRef(scope);
  useEffect(()=>{if(previousScope.current!==scope){previousScope.current=scope;setPage(1);setDetail(null);patchRoute({registerPage:null});}},[scope]);
  useEffect(()=>subscribeRoute(()=>{setPurpose(routeValue('registerPurpose')||'ALL');setStatus(routeValue('registerStatus')||'ALL');setReconciliationStatus(routeValue('registerReconciliation')||'ALL');setPage(Math.max(1,Number(routeValue('registerPage'))||1));}),[]);

  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setMessage('');setLoadError('');
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
    }catch(error){if(signal?.aborted)return;setRows([]);setPagination({page,pageSize:40,total:0,totalPages:1,hasNext:false});setLoadError(error instanceof Error?error.message:'Gagal memuat canonical transaction register');}
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
    <div className="ui-section-card-head"><div><h2>Disbursement Register</h2><p>Hasil eksekusi dan rekonsiliasi provider.</p></div></div>
    <div className="workspace-inline-summary" aria-label="Reconciliation halaman ini"><div><span>Reconciled · halaman ini</span><strong>{loading||loadError?'—':rows.filter(row=>row.reconciliationStatus==='MATCHED').length}</strong></div><div><span>Mismatch · halaman ini</span><strong>{loading||loadError?'—':rows.filter(row=>['PARTIAL','FAILED','ERROR'].includes(String(row.reconciliationStatus))).length}</strong></div><div><span>Pending · halaman ini</span><strong>{loading||loadError?'—':rows.filter(row=>['NOT_RECONCILED','PENDING'].includes(String(row.reconciliationStatus))).length}</strong></div><div><span>Settled · halaman ini</span><strong>{loading||loadError?'—':formatIDR(totals.settled)}</strong></div></div>
    <div className="ui-filter-bar"><label>Purpose<select value={purpose} onChange={event=>{setPurpose(event.target.value);patchRoute({registerPurpose:event.target.value==='ALL'?null:event.target.value,registerPage:null});}}><option value="ALL">Semua</option><option value="PAYROLL">Payroll</option><option value="EWA">EWA</option></select></label><label>Status<select value={status} onChange={event=>{setStatus(event.target.value);patchRoute({registerStatus:event.target.value==='ALL'?null:event.target.value,registerPage:null});}}><option value="ALL">Semua</option>{['PENDING_APPROVAL','APPROVED','PROCESSING','RECONCILIATION_REQUIRED','PARTIALLY_SETTLED','RECONCILED','SETTLED','FAILED'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label><label>Reconciliation<select value={reconciliationStatus} onChange={event=>{setReconciliationStatus(event.target.value);patchRoute({registerReconciliation:event.target.value==='ALL'?null:event.target.value,registerPage:null});}}><option value="ALL">Semua</option>{['NOT_RECONCILED','PENDING','MATCHED','PARTIAL','FAILED','ERROR'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label><button className="btn" type="button" disabled={loading} onClick={()=>setRefreshKey(v=>v+1)}>Refresh</button></div>
    {message?<UiNotice tone={/gagal|error|diblock|blocked|tidak/i.test(message)?'warning':'info'} title="Transaction Register">{message}</UiNotice>:null}
    {loadError?<div className="workspace-inline-error" role="alert"><strong>Disbursement Register belum dapat dimuat</strong><p>{loadError}</p><button type="button" className="btn" onClick={()=>setRefreshKey(value=>value+1)}>Coba lagi</button></div>:loading?<p role="status">Memuat Disbursement Register…</p>:<><p className="workspace-table-scope">{pagination.total} transaksi sesuai filter · urutan kolom berlaku pada halaman ini.</p><WorkspaceTable paginate={false} label="Disbursement Register" headers={['DR Reference','Payment Instruction','Klien / Project','Provider','Nominal','Penerima','Execution Status','Reconciliation Status','Last Updated','Action']} rows={rows.map(row=>[
      <ReferenceValue key="dr" value={row.clientReference}/>,<ReferenceValue key="pi" value={row.sourceDocumentId}/>,<div key="client">{clientNames[row.clientId]||row.clientId}<small>{row.projectId?projectNames[row.projectId]||row.projectId:'—'}</small></div>,<div key="provider">{row.provider}<small>{row.providerChannel||'Belum terkonfirmasi'}</small></div>,formatIDR(row.amount),row.recipientCount,<UiStatusBadge key="execution" tone={tone(row.executionStatus||row.status)}>{row.executionStatus||row.status}</UiStatusBadge>,<UiStatusBadge key="reconciliation" tone={tone(row.reconciliationStatus||'UNKNOWN')}>{row.reconciliationStatus||'UNKNOWN'}</UiStatusBadge>,row.lastReconciledAt?new Date(row.lastReconciledAt).toLocaleString('id-ID'):'—',<div key="actions" className="canonical-register-actions"><button type="button" className="btn" disabled={detailLoading} onClick={()=>void openDetail(row.disbursementRequestId)}>Detail</button>{canReconcile&&['RECONCILIATION_REQUIRED','PROCESSING','FAILED'].includes(row.status)?<button type="button" className="btn btn-primary" disabled={Boolean(busyId)} onClick={()=>void reconcile(row.disbursementRequestId)}>{busyId===row.disbursementRequestId?'Reconciling…':'Reconcile Provider'}</button>:null}</div>
    ])} emptyTitle="Tidak ada transaksi pada filter ini"/></>}
    <div className="canonical-register-pagination"><span>Halaman {pagination.page} / {pagination.totalPages} · {pagination.total} transaksi terfilter</span><div><button type="button" className="btn" disabled={loading||Boolean(loadError)||page<=1} onClick={()=>{setPage(v=>v-1);patchRoute({registerPage:String(page-1)});}}>Sebelumnya</button><button type="button" className="btn" disabled={loading||Boolean(loadError)||!pagination.hasNext} onClick={()=>{setPage(v=>v+1);patchRoute({registerPage:String(page+1)});}}>Berikutnya</button></div></div>
    {detail?<DetailDrawer title="Canonical Transaction Audit Detail" onClose={()=>setDetail(null)}><section className="canonical-register-detail"><div className="canonical-register-detail-heading"><div><strong>{detail.register.clientReference}</strong><small>{detail.register.status} · {detail.register.provider} · {detail.register.providerSubAccountIdMasked||''}</small></div><button type="button" className="btn" onClick={()=>setDetail(null)}>Tutup detail</button></div><WorkspaceTable label="Beneficiary evidence" headers={['Beneficiary','Client reference','Rekening','Amount','Provider result']} rows={detail.items.map(item=>[item.beneficiary_name,item.client_ref,`${item.bank_code} · ••••${item.account_last4}`,formatIDR(Number(item.amount)),`${item.status} · ${item.provider_transaction_id||item.error_code||'—'}`])}/><strong>Provider reconciliation audit trail</strong>{detail.reconciliationAttempts.length?<WorkspaceTable label="Reconciliation audit trail" headers={['Waktu','Status','Found / Missing','Settled / Failed']} rows={detail.reconciliationAttempts.map(attempt=>[attempt.created_at,`${attempt.status}${attempt.error_code?` · ${attempt.error_code}`:''}`,`${attempt.provider_found_count} / ${attempt.provider_missing_count}`,`${attempt.succeeded_items} / ${attempt.failed_items}`])}/>:<p>Belum ada percobaan reconciliation.</p>}<E2PaySupportJson key={detail.register.disbursementRequestId} requestId={detail.register.disbursementRequestId}/></section></DetailDrawer>:null}
  </section><details className="gateway-archive-disclosure" onToggle={event=>setArchiveOpen(event.currentTarget.open)}><summary>Histori gateway lama (arsip read-only)</summary>{archiveOpen?<LegacyTransactionHistory clientId={clientId} projectId={projectId} period={period} query={query}/>:null}</details></>;
}
