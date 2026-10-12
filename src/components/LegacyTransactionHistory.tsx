'use client';

import {useCallback,useEffect,useState} from 'react';
import {formatIDR} from '@/lib/format';

type History={registerId:string;legacyGatewayId:string;sourceDocumentId:string;documentNo:string|null;clientId:string;projectId:string|null;provider:string;providerStatus:string|null;providerReference:string|null;providerTransactionId:string|null;providerSubAccountIdMasked:string|null;status:string;amount:number;recipientCount:number;succeededItems:number;failedItems:number;unresolvedItems:number;createdAt:string;paidAt:string|null;canExecute:false;canRetry:false;canModify:false};
type Item={id:string;clientRef:string;beneficiaryName:string;bankCode:string;accountLast4:string;amount:number;status:string;providerTransactionId:string|null;journalId:string|null};
const empty={page:1,pageSize:40,total:0,totalPages:1,hasNext:false};

export default function LegacyTransactionHistory({clientId='',projectId='',period='',query=''}:{clientId?:string;projectId?:string;period?:string;query?:string}){
 const [rows,setRows]=useState<History[]>([]);
 const [pagination,setPagination]=useState(empty);
 const [page,setPage]=useState(1);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [detail,setDetail]=useState<{transaction:History;items:Item[]}|null>(null);
 const [status,setStatus]=useState('ALL');
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{setPage(1);setDetail(null);},[clientId,projectId,period,query,status]);
 const load=useCallback(async(signal:AbortSignal)=>{
   setLoading(true);setError('');
   try{
    const params=new URLSearchParams({page:String(page),pageSize:'40'});
    if(clientId)params.set('clientId',clientId);
    if(projectId)params.set('projectId',projectId);
    if(period)params.set('period',period);
    if(query.trim())params.set('query',query.trim());
    if(status!=='ALL')params.set('status',status);
    const res=await fetch(`/api/legacy-transaction-history?${params}`,{cache:'no-store',signal});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||`HTTP ${res.status}`);
    if(signal.aborted)return;
    setRows(body.transactions||[]);setPagination(body.pagination||empty);
   }catch(err){if(!signal.aborted){setRows([]);setPagination(empty);setError(err instanceof Error?err.message:'Legacy history tidak dapat dimuat');}}
   finally{if(!signal.aborted)setLoading(false);}
 },[clientId,projectId,period,query,status,page]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return ()=>controller.abort();},[load,refresh]);
 async function openDetail(id:string){
  setError('');try{
   const res=await fetch(`/api/legacy-transaction-history?id=${encodeURIComponent(id)}`,{cache:'no-store'});
   const body=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(body.error||`HTTP ${res.status}`);
   setDetail({transaction:body.transaction,items:body.items||[]});
  }catch(err){setError(err instanceof Error?err.message:'Detail histori tidak tersedia');}
 }
 return <section className="ui-section-card legacy-transaction-history" aria-label="Legacy Financial History (Read Only)">
   <div className="ui-section-card-head"><div><span>FINANCIAL HISTORY · NON-EXECUTABLE</span><h3>Legacy Payment History</h3><small>Ditampilkan langsung dari ledger gateway lama. Semua status, referensi, dan akun asal tetap dipertahankan; tidak ada konversi menjadi DR atau perintah transfer.</small></div></div>
   <div className="ui-filter-bar"><label>Status historis<select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">Semua status</option>{['CREATED','PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED'].map(x=><option key={x} value={x}>{x}</option>)}</select></label><button type="button" className="btn" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>Refresh History</button><span className="ui-status-badge ui-status-warning">Read Only · No Retry</span></div>
   {error?<div role="alert" className="app-notice-bubble app-notice-error"><span>{error}</span></div>:null}
   {loading?<p>Memuat legacy history…</p>:rows.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>PI / Gateway</th><th>Provider</th><th>Nominal</th><th>Recipient</th><th>Status provider</th><th>Aksi</th></tr></thead><tbody>{rows.map(row=><tr key={row.registerId}><td><strong>{row.documentNo||row.sourceDocumentId}</strong><small style={{display:'block'}}>{row.registerId}</small></td><td>{row.provider}<small style={{display:'block'}}>{row.providerSubAccountIdMasked||'Unspecified'}</small></td><td>{formatIDR(row.amount)}</td><td>{row.recipientCount}<small style={{display:'block'}}>{row.succeededItems} success · {row.failedItems} failed · {row.unresolvedItems} unresolved</small></td><td>{row.status}<small style={{display:'block'}}>{row.providerStatus||'Belum terkonfirmasi'}</small></td><td><button type="button" className="btn" onClick={()=>void openDetail(row.legacyGatewayId)}>Lihat histori</button></td></tr>)}</tbody></table></div>:<p>Belum ada transaksi gateway legacy di database pada filter ini. Ini tidak membuktikan riwayat yang sudah terhapus dapat dipulihkan.</p>}
   <div className="canonical-register-pagination"><span>Halaman {pagination.page} / {pagination.totalPages} · {pagination.total} histori gateway</span><div><button className="btn" type="button" disabled={loading||page<=1} onClick={()=>setPage(x=>x-1)}>Sebelumnya</button><button className="btn" type="button" disabled={loading||!pagination.hasNext} onClick={()=>setPage(x=>x+1)}>Berikutnya</button></div></div>
   {detail?<section className="canonical-register-detail" aria-label="Legacy Provider Historical Detail"><div className="canonical-register-detail-heading"><div><strong>{detail.transaction.registerId} · {detail.transaction.status}</strong><small>Referensi provider: {detail.transaction.providerReference||detail.transaction.providerTransactionId||'—'}</small></div><button className="btn" type="button" onClick={()=>setDetail(null)}>Tutup</button></div><div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Beneficiary</th><th>Client Ref</th><th>Rekening</th><th>Nominal</th><th>Provider</th></tr></thead><tbody>{detail.items.map(item=><tr key={item.id}><td>{item.beneficiaryName}</td><td>{item.clientRef}</td><td>{item.bankCode} · ••••{item.accountLast4}</td><td>{formatIDR(item.amount)}</td><td>{item.status} · {item.providerTransactionId||item.journalId||'—'}</td></tr>)}</tbody></table></div><small>Reconciliation dan penyelesaian transaksi legacy dilakukan sesuai histori provider yang sah. Panel ini tidak memiliki tombol execution, retry, ataupun perubahan data.</small></section>:null}
 </section>;
}
