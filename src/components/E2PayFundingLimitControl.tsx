'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import {formatIDR} from '@/lib/format';
import {
  approveE2PayDisbursementLimit,
  getE2PayDisbursementLimits,
  getE2PayOverview,
  rejectE2PayDisbursementLimit,
  requestE2PayDisbursementLimit,
  revokeE2PayDisbursementLimit,
  type E2PayDisbursementLimitRequest,
  type E2PayFundingState,
} from '@/lib/e2pay-api';

type ClientOption={id:string;name:string};
export default function E2PayFundingLimitControl({role}:{role:string}){
  const [funding,setFunding]=useState<E2PayFundingState[]>([]);
  const [requests,setRequests]=useState<E2PayDisbursementLimitRequest[]>([]);
  const [clients,setClients]=useState<ClientOption[]>([]);
  const [clientId,setClientId]=useState('');
  const [amount,setAmount]=useState('');
  const [reason,setReason]=useState('Alokasi limit disbursement payroll');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const canRequest=role==='PAYROLL_PROCESSOR';
  const canApprove=role==='PAYROLL_CONTROLLER';
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const [data,masterData]=await Promise.all([
        getE2PayDisbursementLimits(),
        fetch('/api/client-projects',{headers:{Accept:'application/json'},cache:'no-store'}).then(r=>r.ok?r.json():Promise.resolve({clients:[]})),
      ]);
      setFunding(data.funding);
      setRequests(data.requests);
      setClients((masterData.clients||[]).map((c:ClientOption)=>({id:c.id,name:c.name})));
      setClientId(current=>(masterData.clients||[]).some((c:ClientOption)=>c.id===current)?current:(masterData.clients?.[0]?.id||''));
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal memuat Master Funding');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const master=funding.find(row=>row.providerAccountRegistryId && !row.clientId)||funding[0]||null;
  const selectedRequests=useMemo(()=>clientId?requests.filter(row=>row.clientId===clientId):requests,[requests,clientId]);
  const pending=selectedRequests.filter(row=>row.status==='PENDING_APPROVAL');
  const active=selectedRequests.filter(row=>row.status==='ACTIVE');
  const balance=master?.parent?.balance??null;
  const masterReady=Boolean(master?.parent?.ready && master?.accountReadiness?.ready);

  async function execute(key:string,action:()=>Promise<unknown>,success:string){
    setBusy(key);setMessage('');
    try{await action();await load();setMessage(success);}
    catch(error){setMessage(error instanceof Error?error.message:'Aksi gagal');}
    finally{setBusy('');}
  }
  async function refreshBalance(){
    await execute('SYNC',()=>getE2PayOverview(true),'Saldo Master berhasil diperbarui.');
  }
  async function submitLimit(){
    if(!master||!clientId)return setMessage('Pilih klien dan pastikan Master Account tersedia.');
    const value=Number(amount);
    if(!Number.isSafeInteger(value)||value<=0)return setMessage('Nominal limit tidak valid.');
    if(reason.trim().length<5)return setMessage('Alasan limit minimal 5 karakter.');
    await execute('REQUEST',()=>requestE2PayDisbursementLimit({
      providerAccountRegistryId:master.providerAccountRegistryId,
      clientId,
      amount:value,
      reason:reason.trim(),
    }),'Permintaan limit dikirim ke Payroll Controller.');
    setAmount('');
  }
  async function respond(id:string,kind:'APPROVE'|'REJECT'|'REVOKE'){
    const action=kind==='APPROVE'?()=>approveE2PayDisbursementLimit(id)
      :()=>{const reason=window.prompt(kind==='REJECT'?'Alasan penolakan (minimal 10 karakter)':'Alasan pencabutan (minimal 10 karakter)');
        if(!reason||reason.trim().length<10)return Promise.reject(new Error('Alasan minimal 10 karakter diperlukan.'));
        return kind==='REJECT'?rejectE2PayDisbursementLimit(id,reason):revokeE2PayDisbursementLimit(id,reason);};
    await execute(kind+id,action,kind==='APPROVE'?'Limit disetujui.':'Keputusan Controller tercatat.');
  }
  return <section className="card ui-section-card" aria-label="Master Funding dan Limit">
    <div className="ui-section-card-head">
      <div><span className="workspace-eyebrow">MASTER FUNDING</span><h2>Balance Master &amp; Limit Klien</h2>
        <p>Satu saldo E2Pay Master. Processor mengajukan limit per klien, Controller menyetujui sebelum pembayaran.</p></div>
      <button type="button" className="btn" disabled={loading||Boolean(busy)} onClick={()=>void refreshBalance()}>{busy==='SYNC'?'Menyinkronkan…':'Refresh Saldo Master'}</button>
    </div>
    {message?<p className="ui-notice" role="status">{message}</p>:null}
    <div className="ui-metric-grid">
      <div className="card ui-metric-card"><span>Balance E2Pay Master</span><strong>{balance===null?'Belum tersinkron':formatIDR(balance)}</strong>
        <small>{master?.parent?.ready?'Saldo tervalidasi':'Perlu validasi saldo terbaru'}</small></div>
      <div className="card ui-metric-card"><span>Approved Limit Aktif</span><strong>{formatIDR(requests.filter(row=>row.status==='ACTIVE').reduce((sum,row)=>sum+row.remainingAmount,0))}</strong>
        <small>Akumulasi alokasi dari seluruh klien</small></div>
      <div className="card ui-metric-card"><span>Master Readiness</span><strong>{masterReady?'READY':'NOT READY'}</strong>
        <small>{master?.environment||'UAT'} · {master?.parent?.state||'Belum terhubung'}</small></div>
    </div>
    {!master?<p role="status">Master Account belum aktif. Super Admin perlu melakukan validasi dan binding Master E2Pay melalui pengaturan integrasi.</p>:null}
    <div className="card ui-filter-bar">
      <label className="ui-form-field"><span>Klien</span><select value={clientId} onChange={e=>setClientId(e.target.value)}>
        {!clients.length?<option value="">Belum ada klien</option>:clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
    </div>
    {canRequest?<div className="card ui-section-card">
      <strong>Ajukan Disbursement Limit</strong>
      <div className="directory-form-grid">
        <label className="ui-form-field"><span>Nominal (IDR)</span><input inputMode="numeric" type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <label className="ui-form-field"><span>Alasan</span><input value={reason} onChange={e=>setReason(e.target.value)}/></label>
      </div>
      <button type="button" className="btn btn-primary" disabled={!masterReady||!clientId||Boolean(busy)} onClick={()=>void submitLimit()}>Ajukan ke Controller</button>
    </div>:null}
    <div className="card ui-section-card"><strong>Permintaan dan Alokasi Limit</strong>
      {!selectedRequests.length?<p>Belum ada pengajuan limit untuk klien ini.</p>:null}
      {selectedRequests.map(row=><div key={row.id} className="directory-inline-actions">
        <span>{row.clientName||row.clientCode||row.clientId} · {row.status} · {formatIDR(row.requestedAmount)} · Sisa {formatIDR(row.remainingAmount)}</span>
        {canApprove&&row.status==='PENDING_APPROVAL'?<>
          <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void respond(row.id,'APPROVE')}>Setujui</button>
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={()=>void respond(row.id,'REJECT')}>Tolak</button>
        </>:null}
        {canApprove&&row.status==='ACTIVE'?<button type="button" className="btn" disabled={Boolean(busy)} onClick={()=>void respond(row.id,'REVOKE')}>Cabut</button>:null}
      </div>)}
    </div>
    <small>{pending.length} menunggu Controller · {active.length} limit aktif untuk klien terpilih. Eksekusi disbursement tetap melalui approved Payment Instruction.</small>
  </section>;
}
