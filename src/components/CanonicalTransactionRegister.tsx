'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatIDR } from '@/lib/format';
import { Notice as UiNotice, StatusBadge as UiStatusBadge } from '@/components/ui/UnifiedSystem';

type Actor={role:string;permissions?:string[]};
type Tx={disbursementRequestId:string;clientId:string;purpose:string;destinationMode:string;beneficiaryType:string;sourceDocumentType:string;sourceDocumentId:string;provider:string;providerSubAccountIdMasked?:string|null;providerChannel?:string|null;clientReference:string;amount:number;currency:string;recipientCount:number;status:string;executionStatus?:string|null;reconciliationStatus?:string|null;succeededItems:number;failedItems:number;unresolvedItems:number;settledAmount:number;failedAmount:number;requestedBy?:string|null;approvedBy?:string|null;createdAt:string;lastReconciledAt?:string|null};

const tone=(status:string)=>status==='RECONCILED'||status==='SETTLED'||status==='MATCHED'?'success':status==='FAILED'||status==='RECONCILIATION_REQUIRED'?'warning':'neutral';

export default function CanonicalTransactionRegister({actor,clientId=''}:{actor:Actor|null;clientId?:string}){
  const [rows,setRows]=useState<Tx[]>([]);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState('');
  const [message,setMessage]=useState('');
  const [purpose,setPurpose]=useState('ALL');
  const [status,setStatus]=useState('ALL');
  const canReconcile=actor?.role==='PAYROLL_CONTROLLER'&&Boolean(actor?.permissions?.includes('reconciliation:write'));
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const params=new URLSearchParams();
      if(clientId)params.set('clientId',clientId);
      if(purpose!=='ALL')params.set('purpose',purpose);
      if(status!=='ALL')params.set('status',status);
      const response=await fetch(`/api/canonical-transaction-register?${params}`,{headers:{Accept:'application/json'}});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);
      setRows(body.transactions||[]);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal memuat canonical transaction register');}
    finally{setLoading(false);}
  },[clientId,purpose,status]);
  useEffect(()=>{void load();},[load]);
  async function reconcile(id:string){
    setBusyId(id);setMessage('');
    try{
      const response=await fetch('/api/canonical-transaction-register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'RECONCILE',disbursementRequestId:id})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);
      setMessage(`Reconciliation ${body.outcome?.attemptStatus||'selesai'} · ${body.summary?.succeeded||0}/${body.summary?.total||0} settled.`);
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Reconciliation gagal');}
    finally{setBusyId('');}
  }
  const totals=useMemo(()=>({count:rows.length,amount:rows.reduce((s,r)=>s+Number(r.amount||0),0),settled:rows.reduce((s,r)=>s+Number(r.settledAmount||0),0),unresolved:rows.reduce((s,r)=>s+Number(r.unresolvedItems||0),0)}),[rows]);
  return <section className="ui-section-card">
    <div className="ui-section-card-head"><div><span>CANONICAL REGISTER</span><h3>Disbursement Transaction Register</h3><small>Payroll Direct, Payroll Corporate, dan EWA dalam satu register provider-aware.</small></div></div>
    <div className="directory-detail-grid"><div><span>Transactions</span><strong>{totals.count}</strong></div><div><span>Total value</span><strong>{formatIDR(totals.amount)}</strong></div><div><span>Settled</span><strong>{formatIDR(totals.settled)}</strong></div><div><span>Unresolved items</span><strong>{totals.unresolved}</strong></div></div>
    <div className="ui-filter-bar"><label>Purpose<select value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="ALL">Semua</option><option value="PAYROLL">Payroll</option><option value="EWA">EWA</option></select></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">Semua</option>{['RECONCILIATION_REQUIRED','PARTIALLY_SETTLED','RECONCILED','SETTLED','FAILED','PROCESSING'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label><button type="button" className="btn" onClick={()=>void load()}>Refresh</button></div>
    {message?<UiNotice tone={/gagal|error|diblock|blocked/i.test(message)?'warning':'info'} title="Transaction Register">{message}</UiNotice>:null}
    {loading?<p>Memuat register…</p>:rows.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Reference</th><th>Type</th><th>Provider</th><th>Amount</th><th>Recipients</th><th>Status</th><th>Reconciliation</th><th>Aksi</th></tr></thead><tbody>{rows.map(row=><tr key={row.disbursementRequestId}><td><strong>{row.clientReference}</strong><br/><small>{row.sourceDocumentType} · {row.sourceDocumentId}</small></td><td>{row.purpose}<br/><small>{row.destinationMode.replaceAll('_',' ')}</small></td><td>{row.provider}<br/><small>{row.providerChannel||'-'} · {row.providerSubAccountIdMasked||'-'}</small></td><td>{formatIDR(row.amount)}<br/><small>Settled {formatIDR(row.settledAmount)}</small></td><td>{row.recipientCount}<br/><small>{row.succeededItems} success · {row.failedItems} failed · {row.unresolvedItems} pending</small></td><td><UiStatusBadge tone={tone(row.status)}>{row.status}</UiStatusBadge></td><td>{row.reconciliationStatus||'NOT_RECONCILED'}<br/><small>{row.lastReconciledAt?new Date(row.lastReconciledAt).toLocaleString('id-ID'):'-'}</small></td><td>{canReconcile&&['RECONCILIATION_REQUIRED','PROCESSING','FAILED'].includes(row.status)?<button type="button" className="btn btn-primary" disabled={busyId===row.disbursementRequestId} onClick={()=>void reconcile(row.disbursementRequestId)}>{busyId===row.disbursementRequestId?'Reconciling…':'Reconcile Provider'}</button>:'-'}</td></tr>)}</tbody></table></div>:<UiNotice tone="info" title="Belum ada canonical transaction">Canonical DR yang dieksekusi akan muncul di register ini.</UiNotice>}
  </section>;
}
