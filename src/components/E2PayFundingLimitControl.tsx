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

  const selectedActiveLimit=selected?active.find((item)=>item.providerAccountRegistryId===selected.providerAccountRegistryId):null;
  const messageIsError=/gagal|tidak|wajib|belum|insufficient|stale/i.test(message);

  return <section className="card ui-section-card">
    <div className="ui-section-card-head">
      <div>
        <span className="workspace-eyebrow">FUNDING CONTROL</span>
        <h2 style={{marginTop:4}}>ProQPay → Sub-client → Disbursement Limit</h2>
        <p>Kelola sinkronisasi saldo dan limit disbursement dengan maker-checker antara Payroll Processor dan Payroll Controller.</p>
      </div>
      <div className="ui-section-card-action">
        <button type="button" className="btn" disabled={loading||Boolean(busy)} onClick={()=>void load()}>
          {loading?'Memuat…':'Refresh'}
        </button>
      </div>
    </div>

    <div className="ui-stack">
      {message?<div className={`card ui-section-card ui-notice ${messageIsError?'ui-notice-error':'ui-notice-success'}`} role="status">
        <div>
          <strong>{messageIsError?'Perlu perhatian':'Informasi'}</strong>
          <span>{message}</span>
        </div>
      </div>:null}

      <div className="card ui-filter-bar">
        <div className="ui-filter-bar-head">
          <div>
            <strong>Funding account</strong>
            <span>Pilih sub-client yang akan disinkronkan atau diberikan limit.</span>
          </div>
          {selected?<span className={`ui-status-badge ${selected.state==='READY'?'ui-status-success':selected.state==='SUBCLIENT_NOT_SYNCED'?'ui-status-warning':'ui-status-accent'}`}>
            {selected.state==='SUBCLIENT_NOT_SYNCED'?'Perlu sinkronisasi':selected.state}
          </span>:null}
        </div>
        <label className="ui-form-field">
          <span>Sub-client / account</span>
          <select value={accountId} onChange={(event)=>setAccountId(event.target.value)} disabled={loading||!funding.length}>
            {!funding.length?<option value="">Belum ada funding account</option>:null}
            {funding.map((row)=><option key={row.providerAccountRegistryId} value={row.providerAccountRegistryId}>
              {(row.clientName||row.clientCode||row.clientId)}{row.projectName?` · ${row.projectName}`:''} · {row.providerSubAccountIdMasked||'Sub-account'}
            </option>)}
          </select>
          {selected?<small>
            Parent {selected.parent.balance===null?'belum sync':formatIDR(selected.parent.balance)} · Sub-client {selected.subClient.availableBalance===null?'belum sync':formatIDR(selected.subClient.availableBalance)}
            {selectedActiveLimit?` · Limit tersisa ${formatIDR(selectedActiveLimit.remainingAmount)}`:' · Limit belum aktif'}
          </small>:null}
        </label>
      </div>

      {selected?<div className="ui-metric-grid">
        <div className="card ui-metric-card">
          <span>Balance ProQPay</span>
          <strong>{selected.parent.balance===null?'Belum sync':formatIDR(selected.parent.balance)}</strong>
          <small>{selected.parent.state==='STALE'?'Perlu refresh saldo':selected.parent.state}</small>
        </div>
        <div className={`card ui-metric-card ${selected.subClient.availableBalance===null?'ui-tone-warning':''}`}>
          <span>Balance Sub-client</span>
          <strong>{selected.subClient.availableBalance===null?'Belum sync':formatIDR(selected.subClient.availableBalance)}</strong>
          <small>{selected.subClient.state==='NOT_SYNCED'?'Belum pernah disinkronkan':selected.subClient.state}</small>
        </div>
        <div className="card ui-metric-card">
          <span>Approval Capacity</span>
          <strong>{formatIDR(selected.approvalCapacity||0)}</strong>
          <small>Minimum saldo parent & sub-client</small>
        </div>
        <div className={`card ui-metric-card ${selected.effectiveDisbursementCapacity>0?'ui-tone-success':'ui-tone-warning'}`}>
          <span>Disbursement Capacity</span>
          <strong>{formatIDR(selected.effectiveDisbursementCapacity||0)}</strong>
          <small>{selected.state==='SUBCLIENT_NOT_SYNCED'?'Menunggu sinkronisasi sub-client':selected.state}</small>
        </div>
      </div>:null}

      {selected&&(canRequest||canApprove)?<div className="ui-action-bar">
        <div className="ui-action-bar-meta">
          Sinkronkan saldo provider sebelum menentukan atau menyetujui limit disbursement.
        </div>
        <div className="ui-action-bar-actions">
          <button type="button" className="btn" disabled={busy==='SYNC'} onClick={()=>void syncFunding()}>
            {busy==='SYNC'?'Menyinkronkan…':'Sync balance'}
          </button>
        </div>
      </div>:null}

      {selected&&canRequest?<div className="card ui-filter-bar">
        <div className="ui-filter-bar-head">
          <div>
            <strong>Ajukan limit disbursement</strong>
            <span>Payroll Controller akan melakukan approval sebelum limit dapat digunakan.</span>
          </div>
        </div>
        <div className="ui-form-stack">
          <div className="ui-form-grid">
            <label className="ui-form-field">
              <span>Nominal limit</span>
              <input type="number" min="1" value={amount} onChange={(event)=>setAmount(event.target.value)} placeholder="Contoh: 20000000" />
              <small>Maksimum mengikuti approval capacity yang tersedia.</small>
            </label>
            <label className="ui-form-field">
              <span>Alasan</span>
              <input value={reason} onChange={(event)=>setReason(event.target.value)} maxLength={500} />
              <small>Berikan alasan operasional yang cukup untuk proses approval.</small>
            </label>
          </div>
          <div className="ui-form-actions">
            <button type="button" className="btn btn-primary" disabled={busy==='REQUEST'||!amount||reason.trim().length<5} onClick={()=>void requestLimit()}>
              {busy==='REQUEST'?'Mengirim…':'Ajukan Limit ke Controller'}
            </button>
          </div>
        </div>
      </div>:null}

      {pending.length?<div className="card ui-filter-bar">
        <div className="ui-filter-bar-head">
          <div>
            <strong>Menunggu approval Controller</strong>
            <span>{pending.length} request limit membutuhkan keputusan.</span>
          </div>
          <span className="ui-status-badge ui-status-warning">Pending {pending.length}</span>
        </div>
        <div className="ui-table-wrap">
          <table className="ui-data-table">
            <thead><tr><th>Sub-client</th><th>Nominal</th><th>Alasan</th><th>Requester</th>{canApprove?<th>Aksi</th>:null}</tr></thead>
            <tbody>{pending.map((item)=><tr key={item.id}>
              <td><strong>{item.clientName||item.clientCode||item.clientId}</strong><br/><small>{item.projectName||'Client level'}</small></td>
              <td><strong>{formatIDR(item.requestedAmount)}</strong></td>
              <td>{item.reason||'-'}</td>
              <td>{item.requestedByEmail}</td>
              {canApprove?<td>
                <div className="ui-cluster">
                  <button className="btn" disabled={Boolean(busy)} onClick={()=>{const rejectReason=window.prompt('Alasan penolakan limit (minimal 10 karakter):');if(rejectReason)void run('REJECT-'+item.id,()=>rejectE2PayDisbursementLimit(item.id,rejectReason),'Limit ditolak.');}}>Reject</button>
                  <button className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void run('APPROVE-'+item.id,()=>approveE2PayDisbursementLimit(item.id),'Limit disetujui dan aktif.')}>Approve Limit</button>
                </div>
              </td>:null}
            </tr>)}</tbody>
          </table>
        </div>
      </div>:null}

      {active.length?<div className="card ui-filter-bar">
        <div className="ui-filter-bar-head">
          <div>
            <strong>Limit aktif</strong>
            <span>Monitor committed dan remaining capacity per sub-client.</span>
          </div>
          <span className="ui-status-badge ui-status-success">Active {active.length}</span>
        </div>
        <div className="ui-table-wrap">
          <table className="ui-data-table">
            <thead><tr><th>Sub-client</th><th>Approved</th><th>Committed</th><th>Remaining</th>{canApprove?<th>Aksi</th>:null}</tr></thead>
            <tbody>{active.map((item)=><tr key={item.id}>
              <td><strong>{item.clientName||item.clientCode||item.clientId}</strong><br/><small>{item.projectName||'Client level'}</small></td>
              <td>{formatIDR(item.approvedAmount||0)}</td>
              <td>{formatIDR(item.committedAmount)}</td>
              <td><strong>{formatIDR(item.remainingAmount)}</strong></td>
              {canApprove?<td><button className="btn" disabled={Boolean(busy)} onClick={()=>{const revokeReason=window.prompt('Alasan revoke limit (minimal 10 karakter):');if(revokeReason)void run('REVOKE-'+item.id,()=>revokeE2PayDisbursementLimit(item.id,revokeReason),'Limit direvoke.');}}>Revoke</button></td>:null}
            </tr>)}</tbody>
          </table>
        </div>
      </div>:null}
    </div>
  </section>;
}
