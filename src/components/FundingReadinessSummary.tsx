'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import {getE2PayDisbursementLimits,type E2PayFundingState} from '@/lib/e2pay-api';

export default function FundingReadinessSummary({role,clientId,projectId,onOpen}:{role:string;clientId:string;projectId:string;onOpen:()=>void}){
  const [accounts,setAccounts]=useState<E2PayFundingState[]>([]);
  const [loading,setLoading]=useState(true);
  const [verified,setVerified]=useState(false);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);setVerified(false);setError('');
    try{const data=await getE2PayDisbursementLimits();setAccounts(data.funding||[]);setVerified(true);}
    catch(cause){setAccounts([]);setError(cause instanceof Error?cause.message:'Funding readiness tidak tersedia');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const relevant=useMemo(()=>accounts.filter(row=>(clientId==='ALL'||row.clientId===clientId)&&(projectId==='ALL'||row.projectId===projectId)),[accounts,clientId,projectId]);
  const ready=relevant.filter(row=>row.ready&&row.accountReadiness?.ready).length;
  const recovery=relevant.filter(row=>row.legacyCompatibility==='LEGACY_CREDENTIAL_RECOVERY_REQUIRED'||row.credentialHealth?.recoveryRequired).length;
  const notReady=verified?relevant.length-ready:0;
  const parentFresh=relevant.filter(row=>row.parent.ready).length;
  const subClientFresh=relevant.filter(row=>row.subClient.ready).length;
  const limitReady=relevant.filter(row=>row.limit.ready).length;
  if(!['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(role))return null;
  return <section className="funding-readiness-summary" aria-label="Funding & Liquidity Summary">
    <div className="funding-readiness-title"><div><strong>E2Pay Funding & Liquidity</strong><small>Parent → Sub-client → Approved Limit · Live database snapshot</small></div><div><button type="button" className="btn" disabled={loading} onClick={()=>void load()}>Sync status UI</button><button type="button" className="btn" onClick={onOpen}>Buka Funding & Limit</button></div></div>
    {error?<div className="app-notice-bubble app-notice-error" role="status"><strong>Funding belum dapat diverifikasi</strong><span>{error}</span></div>:null}
    <div className="funding-readiness-items"><div><span>Account READY</span><strong>{verified?`${ready}/${relevant.length}`:'—'}</strong></div><div><span>Parent fresh</span><strong>{verified?parentFresh:'—'}</strong></div><div><span>Sub-client fresh</span><strong>{verified?subClientFresh:'—'}</strong></div><div><span>Limit READY</span><strong>{verified?limitReady:'—'}</strong></div><div><span>Legacy recovery</span><strong>{verified?recovery:'—'}</strong></div></div>
    <small>{loading?'Memeriksa status provider…':verified?`${notReady} account membutuhkan tindakan dari ${relevant.length} account. Nominal tidak dijumlahkan antar sub-client agar saldo parent tidak terhitung ganda.`:'Data live belum terkonfirmasi; approval & eksekusi tetap dibatasi backend.'}</small>
  </section>;
}
