'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatIDR } from '@/lib/format';
import {
  approveE2PayDisbursementLimit,
  getE2PayDisbursementLimits,
  getE2PayOverview,
  rejectE2PayDisbursementLimit,
  requestE2PayDisbursementLimit,
  revokeE2PayDisbursementLimit,
  syncE2PaySubAccountBalance,
  type E2PayDisbursementLimitRequest,
  type E2PayFundingState,
} from '@/lib/e2pay-api';

export default function E2PayFundingLimitControl({role}:{role:string}) {
  const [funding,setFunding]=useState<E2PayFundingState[]>([]);
  const [requests,setRequests]=useState<E2PayDisbursementLimitRequest[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [accountId,setAccountId]=useState('');
  const [amount,setAmount]=useState('');
  const [reason,setReason]=useState('Limit operasional disbursement payroll');

  const canRequest=role==='PAYROLL_PROCESSOR';
  const canApprove=role==='PAYROLL_CONTROLLER';

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const data=await getE2PayDisbursementLimits();
      setFunding(data.funding);
      setRequests(data.requests);
      if(!accountId&&data.funding.length) setAccountId(data.funding[0].providerAccountRegistryId);
      setMessage('');
    }catch(error){
      setMessage(error instanceof Error?error.message:'Funding & limit gagal dimuat');
    }finally{
      setLoading(false);
    }
  },[accountId]);

  useEffect(()=>{void load();},[load]);

  const selected=useMemo(()=>funding.find((row)=>row.providerAccountRegistryId===accountId)||null,[funding,accountId]);
  const pending=requests.filter((row)=>row.status==='PENDING_APPROVAL');
  const active=requests.filter((row)=>row.status==='ACTIVE');

  async function run(key:string,task:()=>Promise<unknown>,success:string){
    setBusy(key); setMessage('');
    try{
      await task();
      setMessage(success);
      await load();
    }catch(error){
      setMessage(error instanceof Error?error.message:'Aksi gagal');
    }finally{
      setBusy('');
    }
  }

  async function syncFunding(){
    if(!selected) return;
    await run('SYNC',async()=>{
      await getE2PayOverview(true);
      await syncE2PaySubAccountBalance(selected.providerAccountRegistryId,Number(amount||0));
    },'Balance ProQPay dan sub-client tersinkron.');
  }

  async function requestLimit(){
    if(!selected) return;
    const value=Math.trunc(Number(amount||0));
    if(value<=0){setMessage('Nominal limit wajib lebih dari 0.');return;}
    await run('REQUEST',()=>requestE2PayDisbursementLimit({
      providerAccountRegistryId:selected.providerAccountRegistryId,
      amount:value,
      reason:reason.trim(),
    }),'Request limit dikirim ke Payroll Controller.');
    setAmount('');
  }

  return <section className="card" style={{padding:18,display:'grid',gap:14}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div><span className="workspace-eyebrow">FUNDING CONTROL</span><h3 style={{margin:'4px 0 0'}}>ProQPay → Sub-client → Disbursement Limit</h3><p style={{margin:'5px 0 0',color:'var(--text3)',fontSize:13}}>Saldo provider tetap dipisahkan dari limit internal. Processor mengajukan limit; Controller approve/reject.</p></div>
      <button type="button" className="btn" disabled={loading||Boolean(busy)} onClick={()=>void load()}>{loading?'Memuat…':'Refresh'}</button>
    </div>

    {message?<div className={/gagal|tidak|wajib|belum|insufficient|stale/i.test(message)?'app-notice-bubble app-notice-error':'app-notice-bubble app-notice-info'} role="status"><strong>{/gagal|tidak|wajib|belum|insufficient|stale/i.test(message)?'Perlu perhatian':'Informasi'}</strong><span>{message}</span></div>:null}

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
      {funding.map((row)=>{
        const activeLimit=active.find((item)=>item.providerAccountRegistryId===row.providerAccountRegistryId);
        return <button key={row.providerAccountRegistryId} type="button" onClick={()=>setAccountId(row.providerAccountRegistryId)} className="btn" style={{textAlign:'left',padding:14,borderWidth:accountId===row.providerAccountRegistryId?2:1}}>
          <strong>{row.clientName||row.clientCode||row.clientId}</strong>
          <small style={{display:'block',marginTop:5}}>{row.projectName?row.projectName+' · ':''}{row.providerSubAccountIdMasked||'Sub-account'}</small>
          <small style={{display:'block',marginTop:7}}>Parent {row.parent.balance===null?'Belum sync':formatIDR(row.parent.balance)} · Sub-client {row.subClient.availableBalance===null?'Belum sync':formatIDR(row.subClient.availableBalance)}</small>
          <small style={{display:'block',marginTop:4}}>Limit {activeLimit?formatIDR(activeLimit.remainingAmount)+' remaining':'Belum aktif'}</small>
        </button>;
      })}
    </div>

    {selected?<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
      <div className="card" style={{padding:12}}><span style={{fontSize:11,color:'var(--text3)'}}>BALANCE PROQPAY</span><strong style={{display:'block',marginTop:4}}>{selected.parent.balance===null?'Belum sync':formatIDR(selected.parent.balance)}</strong><small>{selected.parent.state}</small></div>
      <div className="card" style={{padding:12}}><span style={{fontSize:11,color:'var(--text3)'}}>BALANCE SUB-CLIENT</span><strong style={{display:'block',marginTop:4}}>{selected.subClient.availableBalance===null?'Belum sync':formatIDR(selected.subClient.availableBalance)}</strong><small>{selected.subClient.state}</small></div>
      <div className="card" style={{padding:12}}><span style={{fontSize:11,color:'var(--text3)'}}>APPROVAL CAPACITY</span><strong style={{display:'block',marginTop:4}}>{formatIDR(selected.approvalCapacity||0)}</strong><small>Min(parent, sub-client)</small></div>
      <div className="card" style={{padding:12}}><span style={{fontSize:11,color:'var(--text3)'}}>DISBURSEMENT CAPACITY</span><strong style={{display:'block',marginTop:4}}>{formatIDR(selected.effectiveDisbursementCapacity||0)}</strong><small>{selected.state}</small></div>
    </div>:null}

    {selected&&(canRequest||canApprove)?<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button type="button" className="btn" disabled={busy==='SYNC'} onClick={()=>void syncFunding()}>{busy==='SYNC'?'Syncing…':'Sync Parent + Sub-client Balance'}</button>
    </div>:null}

    {selected&&canRequest?<div style={{display:'grid',gap:10}}>
      <div style={{display:'grid',gridTemplateColumns:'minmax(180px,240px) minmax(260px,1fr)',gap:10}}>
        <label><span style={{display:'block',fontSize:12,marginBottom:5}}>Nominal limit</span><input type="number" min="1" value={amount} onChange={(event)=>setAmount(event.target.value)} placeholder="Contoh 20000000" /></label>
        <label><span style={{display:'block',fontSize:12,marginBottom:5}}>Alasan</span><input value={reason} onChange={(event)=>setReason(event.target.value)} maxLength={500} /></label>
      </div>
      <div><button type="button" className="btn btn-primary" disabled={busy==='REQUEST'||!amount||reason.trim().length<5} onClick={()=>void requestLimit()}>{busy==='REQUEST'?'Mengirim…':'Ajukan Limit ke Controller'}</button></div>
    </div>:null}

    {pending.length?<div style={{display:'grid',gap:8}}>
      <strong>Menunggu Controller</strong>
      {pending.map((item)=><div key={item.id} className="card" style={{padding:12,display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
        <div><strong>{item.clientName||item.clientCode||item.clientId} · {formatIDR(item.requestedAmount)}</strong><small style={{display:'block',marginTop:4}}>{item.projectName||'Client level'} · {item.requestedByEmail} · {item.reason||'-'}</small></div>
        {canApprove?<div style={{display:'flex',gap:8}}>
          <button className="btn" disabled={Boolean(busy)} onClick={()=>{const reason=window.prompt('Alasan penolakan limit (minimal 10 karakter):');if(reason)void run('REJECT-'+item.id,()=>rejectE2PayDisbursementLimit(item.id,reason),'Limit ditolak.');}}>Reject</button>
          <button className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void run('APPROVE-'+item.id,()=>approveE2PayDisbursementLimit(item.id),'Limit disetujui dan aktif.')}>Approve Limit</button>
        </div>:null}
      </div>)}
    </div>:null}

    {active.length?<div style={{display:'grid',gap:8}}>
      <strong>Limit aktif</strong>
      {active.map((item)=><div key={item.id} className="card" style={{padding:12,display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
        <div><strong>{item.clientName||item.clientCode||item.clientId}</strong><small style={{display:'block',marginTop:4}}>Approved {formatIDR(item.approvedAmount||0)} · Committed {formatIDR(item.committedAmount)} · Remaining {formatIDR(item.remainingAmount)}</small></div>
        {canApprove?<button className="btn" disabled={Boolean(busy)} onClick={()=>{const reason=window.prompt('Alasan revoke limit (minimal 10 karakter):');if(reason)void run('REVOKE-'+item.id,()=>revokeE2PayDisbursementLimit(item.id,reason),'Limit direvoke.');}}>Revoke</button>:null}
      </div>)}
    </div>:null}
  </section>;
}
