'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Notice as UiNotice, StatusBadge as UiStatusBadge } from '@/components/ui/UnifiedSystem';

type Actor={role:string;permissions:string[]};
type Account={id:string;clientId:string;bankCode:string;bankName?:string|null;accountName:string;accountLast4:string;status:string;isPrimary:boolean;verificationVersion:number;verifiedBy?:string|null;verifiedAt?:string|null;governed:boolean};
type Change={id:string;action:string;targetAccountId?:string|null;bankCode?:string|null;bankName?:string|null;accountName?:string|null;accountLast4?:string|null;reason:string;status:string;requestedBy:string;requestedAt:string;verificationReference?:string|null;rejectionReason?:string|null};
type ResponseData={accounts:Account[];changes:Change[];readiness:{ready:boolean;reason:string}};

export default function CorporateBeneficiaryPanel({clientId,clientName,actor}:{clientId:string;clientName:string;actor:Actor|null}){
  const [data,setData]=useState<ResponseData>({accounts:[],changes:[],readiness:{ready:false,reason:'GOVERNED_PRIMARY_REQUIRED'}});
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [bankCode,setBankCode]=useState('');
  const [bankName,setBankName]=useState('');
  const [accountName,setAccountName]=useState(clientName);
  const [accountNumber,setAccountNumber]=useState('');
  const [reason,setReason]=useState('');
  const [verificationReference,setVerificationReference]=useState('');
  const [reviewReason,setReviewReason]=useState('');

  const canRequest=actor?.permissions.includes('corporate-beneficiary:request')||false;
  const canApprove=actor?.permissions.includes('corporate-beneficiary:approve')||false;
  const pending=useMemo(()=>data.changes.find(row=>row.status==='PENDING_APPROVAL')||null,[data.changes]);
  const primary=useMemo(()=>data.accounts.find(row=>row.status==='VERIFIED'&&row.isPrimary)||null,[data.accounts]);

  const load=useCallback(async()=>{
    try{
      const response=await fetch(`/api/client-bank-beneficiaries?clientId=${encodeURIComponent(clientId)}`,{headers:{Accept:'application/json'}});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);
      setData({accounts:body.accounts||[],changes:body.changes||[],readiness:body.readiness||{ready:false,reason:'GOVERNED_PRIMARY_REQUIRED'}});
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal memuat rekening perusahaan');}
  },[clientId]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{setAccountName(clientName);},[clientName]);

  async function post(payload:Record<string,unknown>){
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/client-bank-beneficiaries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body.error||`HTTP ${response.status}`);
      setMessage('Perubahan rekening berhasil diproses.');
      setAccountNumber('');setReason('');setVerificationReference('');setReviewReason('');
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal memproses perubahan rekening');}
    finally{setBusy(false);}
  }

  return <section className="directory-form-card">
    <div className="directory-form-card-title"><span>BANK</span><div><strong>Corporate Settlement Account</strong><small>Master beneficiary untuk Payroll → Client Account. Perubahan selalu maker-checker.</small></div></div>
    <div className="directory-detail-grid">
      <div><span>Readiness</span><strong>{data.readiness.ready?'READY':'BLOCKED'}</strong></div>
      <div><span>Primary</span><strong>{primary?`${primary.bankCode} ••••${primary.accountLast4}`:'Belum tersedia'}</strong></div>
      <div><span>Account name</span><strong>{primary?.accountName||'-'}</strong></div>
      <div><span>Verification</span><strong>{primary?`v${primary.verificationVersion}`:'-'}</strong></div>
    </div>
    {!data.readiness.ready?<UiNotice tone="warning" title="Corporate settlement belum siap">Payroll ke rekening perusahaan diblokir sampai ada rekening primary yang VERIFIED melalui approval Controller.</UiNotice>:<UiNotice tone="info" title="Governed beneficiary aktif">Rekening primary sudah diverifikasi dan dapat dipakai sebagai immutable beneficiary snapshot saat membuat Disbursement Request.</UiNotice>}

    {pending?<div className="directory-inline-actions"><UiNotice tone="warning" title="Menunggu Controller approval">{pending.action} · {pending.bankCode||''} {pending.accountLast4?`••••${pending.accountLast4}`:''} · diajukan {pending.requestedBy}. Alasan: {pending.reason}</UiNotice>
      {canApprove?<div className="directory-form-grid"><label>Verification reference<input value={verificationReference} maxLength={300} placeholder="Bank statement / call-back / ticket" onChange={e=>setVerificationReference(e.target.value)}/></label><label>Alasan reject<input value={reviewReason} maxLength={500} placeholder="Diisi bila reject" onChange={e=>setReviewReason(e.target.value)}/></label><div className="directory-inline-actions"><button type="button" className="btn btn-primary" disabled={busy||verificationReference.trim().length<5} onClick={()=>void post({action:'APPROVE_CHANGE',id:pending.id,verificationReference})}>{busy?'Memproses…':'Approve & Verify'}</button><button type="button" className="btn" disabled={busy||reviewReason.trim().length<10} onClick={()=>void post({action:'REJECT_CHANGE',id:pending.id,reason:reviewReason})}>Reject</button></div></div>:null}
    </div>:null}

    {canRequest&&!pending?<details><summary>{primary?'Ajukan penggantian rekening primary':'Daftarkan rekening primary'}</summary><div className="directory-form-grid">
      <label>Bank code<input value={bankCode} maxLength={40} placeholder="BCA / MANDIRI / ..." onChange={e=>setBankCode(e.target.value.toUpperCase())}/></label>
      <label>Nama bank<input value={bankName} maxLength={120} placeholder="Nama bank" onChange={e=>setBankName(e.target.value)}/></label>
      <label>Nama rekening<input value={accountName} maxLength={180} onChange={e=>setAccountName(e.target.value)}/></label>
      <label>Nomor rekening<input inputMode="numeric" autoComplete="off" value={accountNumber} maxLength={34} onChange={e=>setAccountNumber(e.target.value.replace(/\D/g,''))}/></label>
      <label className="wide">Alasan perubahan<input value={reason} maxLength={500} placeholder="Minimal 10 karakter" onChange={e=>setReason(e.target.value)}/></label>
    </div><button type="button" className="btn btn-primary" disabled={busy||!bankCode||accountName.trim().length<3||accountNumber.length<6||reason.trim().length<10} onClick={()=>void post({action:'REQUEST_PRIMARY_ACCOUNT',clientId,bankCode,bankName,accountName,accountNumber,reason})}>{busy?'Mengajukan…':'Ajukan ke Controller'}</button></details>:null}

    {data.accounts.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>Bank</th><th>Rekening</th><th>Status</th><th>Primary</th><th>Governance</th><th>Aksi</th></tr></thead><tbody>{data.accounts.map(account=><tr key={account.id}><td>{account.bankCode}</td><td>{account.accountName}<br/><small>••••{account.accountLast4}</small></td><td><UiStatusBadge tone={account.status==='VERIFIED'?'success':account.status==='SUSPENDED'?'warning':'neutral'}>{account.status}</UiStatusBadge></td><td>{account.isPrimary?'Ya':'Tidak'}</td><td>{account.governed?`v${account.verificationVersion}`:'Legacy'}</td><td>{canRequest&&!pending?<div className="directory-inline-actions">{account.status==='VERIFIED'&&!account.isPrimary?<button type="button" className="btn" disabled={busy||reason.trim().length<10} onClick={()=>void post({action:'REQUEST_SET_PRIMARY',clientId,accountId:account.id,reason})}>Set Primary</button>:null}{account.status==='VERIFIED'?<button type="button" className="btn" disabled={busy||reason.trim().length<10} onClick={()=>void post({action:'REQUEST_SUSPEND',clientId,accountId:account.id,reason})}>Suspend</button>:null}{account.status!=='REVOKED'?<button type="button" className="btn" disabled={busy||reason.trim().length<10} onClick={()=>void post({action:'REQUEST_REVOKE',clientId,accountId:account.id,reason})}>Revoke</button>:null}</div>:'-'}</td></tr>)}</tbody></table></div>:null}
    {canRequest&&!pending&&data.accounts.length?<label>Alasan aksi rekening existing<input value={reason} maxLength={500} placeholder="Minimal 10 karakter sebelum Set Primary / Suspend / Revoke" onChange={e=>setReason(e.target.value)}/></label>:null}
    {message?<p className="directory-hint">{message}</p>:null}
  </section>;
}
