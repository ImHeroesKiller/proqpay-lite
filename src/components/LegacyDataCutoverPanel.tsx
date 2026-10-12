'use client';
import {useCallback,useEffect,useState} from 'react';
import {formatIDR} from '@/lib/format';

type Entry={id:string;sourceType:string;sourceId:string;clientId:string;sourceAccountId:string;sourceAccountMasked:string|null;legacyStatus:string;amountIdr:number;credentialState:string;linkedPiCount:number;linkedGatewayCount:number;linkedCanonicalCount:number;status:'DATA_ONLY';executionAllowed:false;originalRowsRetained:true};
type Payload={summary:{accounts:number;instructions:number;instructionTotalIdr:number;records:number};records:Entry[];reset:{eligible:false;reason:string};credentialRequiredToView:false};
export default function LegacyDataCutoverPanel({role,clientId=''}:{role:string;clientId?:string}){
 const [data,setData]=useState<Payload|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 const load=useCallback(async(signal:AbortSignal)=>{
   setLoading(true);setError('');
   try{
     const q=new URLSearchParams();if(clientId&&clientId!=='ALL')q.set('clientId',clientId);
     const response=await fetch(`/api/legacy-data-cutover?${q}`,{cache:'no-store',signal});
     const payload=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
     if(!signal.aborted)setData(payload);
   }catch(err){if(!signal.aborted){setData(null);setError(err instanceof Error?err.message:'Data cutover belum dapat diperiksa');}}
   finally{if(!signal.aborted)setLoading(false);}
 },[clientId]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return ()=>controller.abort();},[load,refresh]);
 if(!['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(role))return null;
 return <details className="legacy-data-cutover-panel" aria-label="UAT Credentialless Data Cutover">
   <summary><strong>P5.8.3 · UAT Data Cutover</strong><span>Data tersedia di flow baru · credentialless · pembayaran terkunci</span></summary>
   <div className="legacy-data-cutover-body">
     <p>Data UAT menggunakan referensi source lama yang sama di Payment Workbench. Credential tidak dibutuhkan untuk membaca histori. Tidak ada rekening, PI, atau sub-account yang dihapus/diregistrasi ulang.</p>
     {error?<p role="alert" className="app-notice-bubble app-notice-error">{error}</p>:null}
     {loading?<p>Memeriksa provenance UAT…</p>:data?<>
       <div className="legacy-data-cutover-summary"><div><span>Sub-account UAT terhubung</span><strong>{data.summary.accounts}</strong></div><div><span>PI disatukan ke workspace</span><strong>{data.summary.instructions}</strong></div><div><span>Nilai PI tercatat</span><strong>{formatIDR(data.summary.instructionTotalIdr)}</strong></div></div>
       {data.records.map(row=><div className="legacy-data-cutover-record" key={row.id}><div><strong>{row.sourceType==='UAT_PAYMENT_INSTRUCTION'?'Legacy PI · Data Only':'Legacy E2Pay Sub-account · Data Only'}</strong><small>{row.sourceAccountMasked||'Sub-account belum tersambung'} · {row.legacyStatus} · Credential {row.credentialState}</small></div><span className="ui-status-badge ui-status-warning">Tidak bisa transfer</span></div>)}
       <p className="payment-decision-footnote">Reset total fisik UAT belum dilakukan karena PI/snapshot dan audit menggunakan ID sub-account lama. Backup, referential integrity dan rencana purge terverifikasi wajib sebelum menghapus data sumber.</p>
     </>:null}
     <button type="button" className="btn" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>Refresh data UAT</button>
   </div>
 </details>;
}
