'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatIDR } from '@/lib/format';
import {
  getE2PayBanks,
  getE2PayCatalog,
  getE2PayOverview,
  getE2PayTransactions,
  runE2PayAction,
  type E2PayAccountSnapshot,
  type E2PayCatalogItem,
  type E2PayTransactionRow,
} from '@/lib/e2pay-api';

type Props={ canManage:boolean };

function dateTime(value?:string|null){
  if(!value) return '—';
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
}

function endpointMode(mode:E2PayCatalogItem['mode']){
  if(mode==='PAYMENT_CONTROL_ONLY') return 'Payment Control';
  if(mode==='SERVER_MANAGED') return 'Server managed';
  if(mode==='ADMIN_ACTION') return 'Admin action';
  if(mode==='LIVE_READ') return 'Live read';
  return 'Diagnostic';
}

function Field({label,type='text',value,onChange,placeholder}:{label:string;type?:string;value:string;onChange:(value:string)=>void;placeholder?:string}){
  return <label><span>{label}</span><input type={type} value={value} onChange={(event)=>onChange(event.target.value)} placeholder={placeholder} autoComplete="off" /></label>;
}

export default function E2PayOperationsConsole({canManage}:Props){
  const [account,setAccount]=useState<E2PayAccountSnapshot|null>(null);
  const [catalog,setCatalog]=useState<E2PayCatalogItem[]>([]);
  const [banks,setBanks]=useState<Array<{id:string;name:string;active:string|boolean}>>([]);
  const [banksLoaded,setBanksLoaded]=useState(false);
  const [transactions,setTransactions]=useState<E2PayTransactionRow[]>([]);
  const [transactionsLoaded,setTransactionsLoaded]=useState(false);
  const [transactionCount,setTransactionCount]=useState(0);
  const [loading,setLoading]=useState(false);
  const [actionLoading,setActionLoading]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [bankSearch,setBankSearch]=useState('');
  const [txClientRef,setTxClientRef]=useState('');
  const [txResponseCode,setTxResponseCode]=useState('');
  const [txFrom,setTxFrom]=useState('');
  const [txUntil,setTxUntil]=useState('');
  const [inquiry,setInquiry]=useState({accountId:'',bankId:'',amount:''});
  const [registration,setRegistration]=useState({phone:'',name:'',email:'',token:'',password:''});
  const [reset,setReset]=useState({email:'',accountGroupId:'',token:'',newPassword:''});
  const [password,setPassword]=useState({password:'',newPassword:''});
  const [phone,setPhone]=useState({password:'',phone:'',token:''});
  const [lastResult,setLastResult]=useState('');

  const loadOverview=useCallback(async(force=false)=>{
    setLoading(true);setError('');
    const [overviewResult,catalogResult]=await Promise.allSettled([getE2PayOverview(force),getE2PayCatalog()]);
    if(catalogResult.status==='fulfilled') setCatalog(catalogResult.value.catalog);
    if(overviewResult.status==='fulfilled') setAccount(overviewResult.value.account);
    else setError(overviewResult.reason instanceof Error?overviewResult.reason.message:'E2Pay overview gagal dimuat');
    if(catalogResult.status==='rejected' && overviewResult.status==='fulfilled'){
      setError(catalogResult.reason instanceof Error?catalogResult.reason.message:'Catalog E2Pay gagal dimuat');
    }
    setLoading(false);
  },[]);

  useEffect(()=>{void loadOverview(false);},[loadOverview]);

  const run=useCallback(async(action:string,payload:Record<string,unknown>={})=>{
    setActionLoading(action);setError('');setNotice('');
    try{
      const result=await runE2PayAction(action,payload);
      setLastResult(JSON.stringify(result,null,2));
      setNotice(`${action.replaceAll('_',' ')} berhasil.`);
      if(['REFRESH_ACCOUNT','CHANGE_PASSWORD','RESET_PASSWORD_CONFIRM','CHANGE_PHONE_CONFIRM'].includes(action)) void loadOverview(true);
      return result;
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Operasi E2Pay gagal');
      return null;
    }finally{setActionLoading('');}
  },[loadOverview]);

  async function loadBanks(){
    setActionLoading('BANKS');setError('');
    try{
      const result=await getE2PayBanks({name:bankSearch||undefined,limit:1000});
      setBanks(result.data);setBanksLoaded(true);
    }catch(cause){
      setBanksLoaded(false);
      setError(cause instanceof Error?cause.message:'Bank list gagal dimuat');
    }finally{setActionLoading('');}
  }

  async function loadTransactions(){
    setActionLoading('TRANSACTIONS');setError('');
    try{
      const result=await getE2PayTransactions({
        limit:50,
        clientRef:txClientRef||undefined,
        responseCode:txResponseCode||undefined,
        transactionTimestampFrom:txFrom ? txFrom+' 00:00:00' : undefined,
        transactionTimestampUntil:txUntil ? txUntil+' 23:59:59' : undefined,
      });
      setTransactions(result.data);setTransactionCount(result.rowCount);setTransactionsLoaded(true);
    }catch(cause){
      setTransactionsLoaded(false);
      setError(cause instanceof Error?cause.message:'Transaction history gagal dimuat');
    }finally{setActionLoading('');}
  }

  const endpointCounts=useMemo(()=>{
    const map=new Map<string,number>();
    for(const item of catalog) map.set(item.mode,(map.get(item.mode)||0)+1);
    return map;
  },[catalog]);

  return <section className="e2pay-console e2pay-console-compact" aria-label="E2Pay API Operations Console" aria-busy={loading||Boolean(actionLoading)}>
    <div className="e2pay-console-head">
      <div><span className="workspace-eyebrow">E2PAY B2B API v1.1</span><h4>Provider Operations</h4></div>
      <button type="button" className="btn" disabled={loading} onClick={()=>void loadOverview(true)}>{loading?'Refreshing…':'Refresh provider'}</button>
    </div>

    {error?<div className="app-notice-bubble app-notice-error" role="alert"><strong>E2Pay operation gagal</strong><span>{error}</span></div>:null}
    {notice?<div className="app-notice-bubble app-notice-info" role="status"><span>{notice}</span></div>:null}

    <div className="e2pay-account-hero">
      <div className="e2pay-account-balance">
        <span>Available balance</span>
        <strong>{account?.balance!==null&&account?.balance!==undefined?formatIDR(Number(account.balance)):'—'}</strong>
        <small>{account?.environment||'—'} · {account?.merchantStatus||'status unavailable'}</small>
      </div>
      <div className="e2pay-account-meta">
        <div><span>Merchant</span><strong>{account?.accountName||'—'}</strong><small>{account?.accountIdMasked||'—'}</small></div>
        <div><span>Account group</span><strong>{account?.accountGroupName||'—'}</strong><small>{account?.phoneMasked||'Phone unavailable'}</small></div>
        <div><span>Last sync</span><strong>{dateTime(account?.refreshedAt)}</strong><small>{account?.readiness?.configured?'Execution ready':account?.readiness?.reason||'Not ready'}</small></div>
      </div>
    </div>

    <div className="integrations-two-col e2pay-operational-grid">
      <section className="integration-panel">
        <div className="integration-panel-head"><div><strong>Transaction history</strong><small>Riwayat transaksi provider</small></div><span>{transactionCount}</span></div>
        <div className="e2pay-filter-grid">
          <Field label="Client ref" value={txClientRef} onChange={setTxClientRef} placeholder="PQP-…" />
          <label><span>Response code</span><select value={txResponseCode} onChange={(e)=>setTxResponseCode(e.target.value)}><option value="">Semua</option><option value="00">00 Success</option><option value="96">96 On Process</option><option value="99">99 Failed</option></select></label>
          <Field label="From" type="date" value={txFrom} onChange={setTxFrom} />
          <Field label="Until" type="date" value={txUntil} onChange={setTxUntil} />
        </div>
        <button type="button" className="btn" disabled={actionLoading==='TRANSACTIONS'} onClick={()=>void loadTransactions()}>{actionLoading==='TRANSACTIONS'?'Loading…':'Load history'}</button>
        <div className="e2pay-resource-list">{transactions.slice(0,50).map((row,index)=><article key={row.accountTransactionId||row.journalId||index}><div><strong>{row.transactionName||row.description||'Transaction'}</strong><span>{row.responseCode||'—'}</span></div><small>{row.clientRef||'No clientRef'} · {dateTime(row.transactionTimestamp)}</small><b>{formatIDR(Number(row.amount||0))}</b><em>{row.responseMessage||row.journalId||'—'}</em></article>)}{!transactions.length?<div className="integration-empty">{transactionsLoaded?'Tidak ada transaksi pada filter ini.':'Belum dimuat.'}</div>:null}</div>
      </section>

      <section className="integration-panel">
        <div className="integration-panel-head"><div><strong>Bank directory</strong><small>Bank tujuan yang didukung E2Pay</small></div><span>{banksLoaded?banks.length:'—'}</span></div>
        <div className="e2pay-inline-search"><input value={bankSearch} onChange={(e)=>setBankSearch(e.target.value)} placeholder="Cari nama bank…" /><button type="button" className="btn" disabled={actionLoading==='BANKS'} onClick={()=>void loadBanks()}>{actionLoading==='BANKS'?'Loading…':'Load banks'}</button></div>
        <div className="e2pay-bank-list">{banks.slice(0,100).map((row)=><div key={row.id}><code>{row.id}</code><strong>{row.name}</strong><span>{String(row.active).toLowerCase()==='false'?'Inactive':'Active'}</span></div>)}{!banks.length?<div className="integration-empty">{banksLoaded?'Tidak ada bank yang cocok.':'Belum dimuat.'}</div>:null}</div>
      </section>
    </div>

    <details className="e2pay-collapsible">
      <summary><span>API coverage</span><b>{catalog.length} endpoint</b></summary>
      <div className="e2pay-endpoint-summary">
        <span>{endpointCounts.get('LIVE_READ')||0} live read</span>
        <span>{endpointCounts.get('ADMIN_ACTION')||0} admin action</span>
        <span>{endpointCounts.get('SERVER_MANAGED')||0} server managed</span>
        <span>{endpointCounts.get('DIAGNOSTIC')||0} diagnostic</span>
      </div>
      <div className="e2pay-endpoint-table-wrap"><table className="e2pay-endpoint-table">
        <caption className="sr-only">Daftar endpoint E2Pay B2B API yang terintegrasi</caption>
        <thead><tr><th>Function</th><th>Method</th><th>Canonical path</th><th>Control</th></tr></thead>
        <tbody>{catalog.map((item)=><tr key={item.id}><td><strong>{item.function}</strong><small>{item.id}</small></td><td><code>{item.method}</code></td><td><code>{item.path}</code></td><td><span className={`e2pay-mode e2pay-mode-${item.mode.toLowerCase().replaceAll('_','-')}`}>{endpointMode(item.mode)}</span></td></tr>)}</tbody>
      </table></div>
    </details>

    {canManage?<details className="e2pay-collapsible e2pay-admin-console">
      <summary><span>Advanced administration</span><b>Super Admin</b></summary>
      <div className="e2pay-admin-body">
        <section>
          <h5>Diagnostics</h5>
          <div className="e2pay-action-row">
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('REFRESH_ACCOUNT')}>Refresh account</button>
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('VERIFY_USERNAME')}>Verify username</button>
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('TOKEN_REFRESH_TEST')}>Test refresh token</button>
          </div>
        </section>

        <details className="e2pay-admin-detail">
          <summary>Disbursement inquiry</summary>
          <p>Validasi rekening tujuan dan fee tanpa mengirim uang.</p>
          <div className="e2pay-form-grid">
            <Field label="Destination account" value={inquiry.accountId} onChange={(value)=>setInquiry({...inquiry,accountId:value})} />
            <Field label="Bank ID" value={inquiry.bankId} onChange={(value)=>setInquiry({...inquiry,bankId:value})} />
            <Field label="Amount" type="number" value={inquiry.amount} onChange={(value)=>setInquiry({...inquiry,amount:value})} />
          </div>
          <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('INQUIRY',{...inquiry,amount:Number(inquiry.amount)})}>Run inquiry</button>
        </details>

        <details className="e2pay-admin-detail">
          <summary>Merchant registration</summary>
          <div className="e2pay-form-grid">
            <Field label="Phone" value={registration.phone} onChange={(value)=>setRegistration({...registration,phone:value})} />
            <Field label="Name" value={registration.name} onChange={(value)=>setRegistration({...registration,name:value})} />
            <Field label="Email" value={registration.email} onChange={(value)=>setRegistration({...registration,email:value})} />
          </div>
          <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('REGISTER_REQUEST',registration)}>Registration request</button>
          <div className="e2pay-form-grid">
            <Field label="Username / phone" value={registration.phone} onChange={(value)=>setRegistration({...registration,phone:value})} />
            <Field label="Password" type="password" value={registration.password} onChange={(value)=>setRegistration({...registration,password:value})} />
            <Field label="Token / OTP" type="password" value={registration.token} onChange={(value)=>setRegistration({...registration,token:value})} />
          </div>
          <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('REGISTER_CONFIRM',{username:registration.phone,password:registration.password,token:registration.token})}>Complete registration</button>
        </details>

        <details className="e2pay-admin-detail">
          <summary>Password administration</summary>
          <div className="e2pay-form-grid">
            <Field label="Current password" type="password" value={password.password} onChange={(value)=>setPassword({...password,password:value})} />
            <Field label="New password" type="password" value={password.newPassword} onChange={(value)=>setPassword({...password,newPassword:value})} />
          </div>
          <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('CHANGE_PASSWORD',password)}>Change password</button>
          <hr />
          <div className="e2pay-form-grid">
            <Field label="Merchant email" value={reset.email} onChange={(value)=>setReset({...reset,email:value})} />
            <Field label="Account group ID" value={reset.accountGroupId} onChange={(value)=>setReset({...reset,accountGroupId:value})} />
            <Field label="Reset token" type="password" value={reset.token} onChange={(value)=>setReset({...reset,token:value})} />
            <Field label="New password" type="password" value={reset.newPassword} onChange={(value)=>setReset({...reset,newPassword:value})} />
          </div>
          <div className="e2pay-action-row">
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('RESET_PASSWORD_REQUEST',reset)}>Request reset token</button>
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('RESET_PASSWORD_CONFIRM',reset)}>Confirm reset</button>
          </div>
        </details>

        <details className="e2pay-admin-detail">
          <summary>Phone number administration</summary>
          <div className="e2pay-form-grid">
            <Field label="Current password" type="password" value={phone.password} onChange={(value)=>setPhone({...phone,password:value})} />
            <Field label="New phone" value={phone.phone} onChange={(value)=>setPhone({...phone,phone:value})} />
            <Field label="SMS token" type="password" value={phone.token} onChange={(value)=>setPhone({...phone,token:value})} />
          </div>
          <div className="e2pay-action-row">
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('CHANGE_PHONE_REQUEST',phone)}>Request phone change</button>
            <button type="button" className="btn" disabled={Boolean(actionLoading)} onClick={()=>void run('CHANGE_PHONE_CONFIRM',{phone:phone.phone,token:phone.token})}>Confirm phone change</button>
          </div>
        </details>

        {lastResult?<details className="integration-diagnostics"><summary>Last operation result</summary><pre className="e2pay-json-result">{lastResult}</pre></details>:null}
      </div>
    </details>:null}

    <div className="e2pay-governance-note">Disbursement tetap dijalankan melalui approved Payment Instruction di Payment Control.</div>
  </section>;
}
