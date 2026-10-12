'use client';
import Link from 'next/link';
import {useCallback,useEffect,useState} from 'react';
import {formatIDR} from '@/lib/format';

type RecordRow={id:string;documentNo:string;status:string;clientId:string;projectId:string|null;payrollPeriod:string|null;amount:number;recipientCount:number;destinationMode:string;providerAccountRegistryId:string|null;providerSubAccountIdMasked:string|null;existingGatewayCount:number;existingDrCount:number;snapshotValid:boolean;beneficiaryReady:boolean;providerBound:boolean;credentialReady:boolean;credentialRecoveryRequired:boolean;channel:{ready:boolean;code:string};liquidity:{ready:boolean;state:string;parentState:string;subClientState:string;limitState:string};canCreateCanonicalDr:boolean;readyForControllerApproval:boolean;executionAuthorized:false;providerHistoryVerified:false;blockingCodes:string[];nextAction:string};
const meaning:Record<string,string>={
  LEGACY_GATEWAY_EXISTS_NO_REPLAY:'Transaksi legacy sudah ada; wajib reconciliation, bukan transfer ulang',
  CANONICAL_DR_ALREADY_EXISTS:'DR canonical sudah ada; jangan buat ulang',
  PI_NOT_ELIGIBLE_STATUS:'Status PI belum eligible',
  PI_IMMUTABLE_SNAPSHOT_INVALID:'Snapshot rekening/jumlah penerima/total PI belum valid',
  PI_APPROVAL_HASH_NOT_VERIFIED:'Content hash atau approval PI belum valid',
  PI_PROVIDER_SNAPSHOT_NOT_BOUND:'Routing PI ke sub-account existing perlu direview',
  LEGACY_CREDENTIAL_RECOVERY_REQUIRED:'Credential legacy perlu recovery sekali pada account yang sama',
  MERCHANT_CREDENTIAL_NOT_READY:'Credential scoped belum READY',
  CREDENTIAL_HEALTH_RECHECK_REQUIRED:'Kesehatan credential perlu validasi ulang',
  CORPORATE_BENEFICIARY_NOT_GOVERNED:'Rekening corporate harus diverifikasi melalui maker-checker',
};
export default function LegacyPIReadinessPanel({role,clientId='',sourceId=''}:{role:string;clientId?:string;sourceId?:string}){
 const [rows,setRows]=useState<RecordRow[]>([]);
 const [destination,setDestination]=useState<'DIRECT_EMPLOYEE'|'CLIENT_ACCOUNT'>('DIRECT_EMPLOYEE');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [refresh,setRefresh]=useState(0);
 const load=useCallback(async(signal:AbortSignal)=>{
  setLoading(true);setError('');
  try{
   const query=new URLSearchParams({destinationMode:destination});
   if(clientId&&clientId!=='ALL')query.set('clientId',clientId);
   if(sourceId)query.set('id',sourceId);
   const response=await fetch(`/api/legacy-pi-readiness?${query}`,{signal,cache:'no-store'});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);
   if(!signal.aborted)setRows(body.records||[]);
  }catch(e){if(!signal.aborted){setError(e instanceof Error?e.message:'Readiness PI tidak tersedia');setRows([]);}}
  finally{if(!signal.aborted)setLoading(false);}
 },[clientId,sourceId,destination]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load,refresh]);
 if(!['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(role))return null;
 return <details className="legacy-pi-readiness-panel"><summary><strong>P5.8.2 · Legacy PI Readiness Check</strong><span>Read-only · Credential → Snapshot → Channel → Liquidity</span></summary>
  <div className="legacy-pi-readiness-content">
   <div className="legacy-pi-readiness-tools"><label>Settlement strategy<select value={destination} onChange={e=>setDestination(e.target.value as typeof destination)}><option value="DIRECT_EMPLOYEE">Payroll → Employee</option><option value="CLIENT_ACCOUNT">Payroll → Corporate</option></select></label><button type="button" className="btn" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>Periksa ulang kesiapan</button></div>
   <p className="payment-decision-footnote">Pemeriksaan ini hanya membaca database. Tidak mengikat credential, menyinkronkan provider, menyetujui PI, membuat DR, atau mengirim pembayaran. Status provider eksternal harus diverifikasi sebelum transaksi.</p>
   {error?<p role="alert" className="app-notice-bubble app-notice-error">{error}</p>:null}
   {loading?<p>Memeriksa snapshot PI…</p>:rows.length?rows.map(row=><article className="legacy-pi-readiness-item" key={row.id}>
    <div className="legacy-pi-readiness-heading"><div><strong>{row.documentNo}</strong><small>{formatIDR(row.amount)} · {row.recipientCount} penerima · {row.status}</small></div><span className={`ui-status-badge ${row.canCreateCanonicalDr?'ui-status-success':'ui-status-warning'}`}>{row.canCreateCanonicalDr?'Create DR eligible · by Processor':'Blocked · Review required'}</span></div>
    <div className="legacy-pi-readiness-grid"><div><span>Snapshot & recipient</span><strong>{row.snapshotValid&&row.beneficiaryReady?'VALID':'REVIEW'}</strong></div><div><span>Legacy financial</span><strong>{row.existingGatewayCount===0&&row.existingDrCount===0?'No DB transaction':'Existing transaction'}</strong></div><div><span>Merchant credential</span><strong>{row.credentialReady?'READY':row.credentialRecoveryRequired?'RECOVERY':'NOT READY'}</strong></div><div><span>Provider channel</span><strong>{row.channel.ready?'CONFIRMED':row.channel.code}</strong></div><div><span>Parent / Sub-client / Limit</span><strong>{row.liquidity.ready?'READY':`${row.liquidity.parentState} / ${row.liquidity.subClientState} / ${row.liquidity.limitState}`}</strong></div></div>
    {row.blockingCodes.length?<ul className="legacy-pi-blockers">{row.blockingCodes.map(code=><li key={code}>{meaning[code]||code}</li>)}</ul>:null}
    <div className="legacy-pi-readiness-footer"><span>Next: {row.nextAction.replaceAll('_',' ')}. Execution: disabled by this panel.</span>{row.credentialRecoveryRequired&&row.providerAccountRegistryId&&role!=='PAYROLL_CONTROLLER'?<Link className="btn btn-primary" href={`/?view=clients&recoveryClientId=${encodeURIComponent(row.clientId)}&recoveryAccountId=${encodeURIComponent(row.providerAccountRegistryId)}&recoveryReturnView=payments${row.payrollPeriod?'&period='+encodeURIComponent(row.payrollPeriod):''}`}>Recovery credential existing</Link>:null}</div>
   </article>):<p>Belum ada PI pada filter ini.</p>}
  </div>
 </details>;
}
