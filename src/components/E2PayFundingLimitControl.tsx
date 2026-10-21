'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import {formatIDR} from '@/lib/format';
import {IconRefresh,IconShieldCheck,IconCheckCircle,IconAlertTriangle,IconArrowUpRight} from '@/components/Icons';
import {
  approveE2PayDisbursementLimit,
  getE2PayDisbursementLimits,
  getE2PayOverview,
  getE2PayMasterActivation,
  runE2PayAction,
  type E2PayMasterActivation,
  rejectE2PayDisbursementLimit,
  requestE2PayDisbursementLimit,
  revokeE2PayDisbursementLimit,
  type E2PayDisbursementLimitRequest,
  type E2PayFundingState,
} from '@/lib/e2pay-api';

type ClientOption={id:string;name:string};
export default function E2PayFundingLimitControl({role}:{role:string}){
  const [activation,setActivation]=useState<E2PayMasterActivation|null>(null);
  const [projects,setProjects]=useState<Array<{id:string;client_id?:string;clientId?:string;name:string}>>([]);
  const [projectId,setProjectId]=useState('');
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
      const [data,masterData,activationData]=await Promise.all([
        getE2PayDisbursementLimits(),
        fetch('/api/client-projects',{headers:{Accept:'application/json'},cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('Gagal memuat klien dan project');return r.json();}),
        getE2PayMasterActivation(),
      ]);
      setActivation(activationData);
      setProjects(masterData.projects||[]);
      setFunding(data.funding.filter(row=>row.environment===activationData.environment && row.providerAccountRegistryId===activationData.registryId));
      setRequests(data.requests.filter(row=>row.environment===activationData.environment));
      setClients((masterData.clients||[]).map((c:ClientOption)=>({id:c.id,name:c.name})));
      setClientId(current=>(masterData.clients||[]).some((c:ClientOption)=>c.id===current)?current:(masterData.clients?.[0]?.id||''));
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal memuat Master Funding');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const master=funding.find(row=>row.providerAccountRegistryId===activation?.registryId && !row.clientId)||null;
  const selectedRequests=useMemo(()=>clientId?requests.filter(row=>row.clientId===clientId):requests,[requests,clientId]);
  const pending=selectedRequests.filter(row=>row.status==='PENDING_APPROVAL');
  const active=selectedRequests.filter(row=>row.status==='ACTIVE');
  const balance=master?.parent?.balance??null;
  const masterReady=Boolean(activation?.connectionReady && master?.parent?.ready && master?.accountReadiness?.ready);
  const visibleProjects=projects.filter(p=>(p.client_id||p.clientId)===clientId);

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
      projectId:projectId||undefined,
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
  return <section className="e2pay-funding" aria-label="Master Funding dan Limit" aria-busy={loading}>
    <div className="ui-section-card-head">
      <div><span className="workspace-eyebrow">MASTER FUNDING</span><h2>Balance Master &amp; Limit Klien</h2>
        <p>Satu saldo E2Pay Master. Processor mengajukan limit per klien, Controller menyetujui sebelum pembayaran.</p></div>
      <button type="button" className="btn" disabled={loading||Boolean(busy)} onClick={()=>void refreshBalance()}><IconRefresh aria-hidden="true"/>{busy==='SYNC'?'Menyinkronkan…':'Refresh Saldo Master'}</button>
    </div>
    {message?<p className="ui-notice" role="status">{message}</p>:null}
    <div className="e2pay-funding-summary">
      <div className="ui-metric-card"><span>Balance E2Pay Master</span><strong>{balance===null?'Belum tersinkron':formatIDR(balance)}</strong>
        <small>{master?.parent?.ready?'Saldo tervalidasi':'Perlu validasi saldo terbaru'}</small></div>
      <div className="ui-metric-card"><span>Approved Limit Aktif</span><strong>{formatIDR(requests.filter(row=>row.status==='ACTIVE').reduce((sum,row)=>sum+row.remainingAmount,0))}</strong>
        <small>Akumulasi alokasi dari seluruh klien</small></div>
      <div className="ui-metric-card"><span>Koneksi Master</span><strong>{masterReady?'Tervalidasi':'Perlu tindakan'}</strong>
        <small>{master?.environment||'UAT'} · {master?.parent?.ready?'Saldo terbaru':master?.parent?.state==='STALE'?'Perbarui saldo':'Perlu validasi'}</small></div>
    </div>
    {!master&&!loading?<p className="ui-notice" role="status">Master Account belum aktif. Super Admin perlu melakukan validasi identitas E2Pay.</p>:null}
    {activation?<div className="e2pay-funding-verification" aria-label="Pemeriksaan Master">
      <div className="e2pay-funding-section-head"><div><h3>Pemeriksaan Master</h3><p>Pastikan koneksi dan saldo tervalidasi sebelum mengajukan limit.</p></div>
        <span className="e2pay-funding-environment">{activation.environment}</span>
      </div>
      <ul className="e2pay-funding-checks">{Object.entries(activation.checks).map(([key,ready])=><li key={key}>
        <span>{({credentialConfigured:'Credential pusat',registryActive:'Aktivasi Master',identityMatched:'Identitas provider',merchantActive:'Status merchant',balanceFresh:'Saldo terbaru'} as Record<string,string>)[key]}</span>
        <span className={`e2pay-funding-check ${ready?'is-ready':'needs-action'}`}>{ready?<IconCheckCircle aria-hidden="true"/>:<IconAlertTriangle aria-hidden="true"/>}{ready?'Tervalidasi':'Perlu tindakan'}</span>
      </li>)}</ul>
      <div className="e2pay-funding-verification-footer"><div>
        {activation.environment==='UAT'?<p>Lingkungan pengujian: saldo dan pembayaran menggunakan E2Pay UAT.</p>:null}
        <p>Kanal terkonfirmasi: <b>{activation.channels.filter(c=>c.ready).length}</b>. Pembayaran memerlukan kanal yang sesuai, limit aktif, dan persetujuan PI.</p>
      </div>
      {role==='SUPER_ADMIN'?<button type="button" className="btn btn-primary" disabled={Boolean(busy)||loading||!activation.checks.credentialConfigured} onClick={()=>void execute('BIND_MASTER',()=>runE2PayAction('BIND_MASTER_ACCOUNT'),'Identitas Master tervalidasi dan aktivasi tersimpan.')}><IconShieldCheck aria-hidden="true"/>{busy==='BIND_MASTER'?'Memvalidasi…':'Validasi & Aktifkan Master'}</button>:null}
      </div>
    </div>:null}
    <div className="e2pay-funding-filters">
      <label className="ui-form-field"><span>Klien</span><select value={clientId} onChange={e=>{setClientId(e.target.value);setProjectId('');}}>
        {!clients.length?<option value="">Belum ada klien</option>:clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
    {canRequest?<label className="ui-form-field"><span>Project untuk limit</span><select value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">Seluruh klien</option>{visibleProjects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>:null}
    </div>
    {canRequest?<div className="e2pay-funding-request">
      <div className="e2pay-funding-section-head"><div><h3>Ajukan Disbursement Limit</h3><p>Pengajuan akan diperiksa oleh Payroll Controller.</p></div></div>
      <div className="e2pay-funding-form">
        <label className="ui-form-field"><span>Nominal (IDR)</span><input inputMode="numeric" type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <label className="ui-form-field"><span>Alasan</span><input value={reason} onChange={e=>setReason(e.target.value)}/></label>
      </div>
      <button type="button" className="btn btn-primary" disabled={!masterReady||!clientId||Boolean(busy)} onClick={()=>void submitLimit()}><IconArrowUpRight aria-hidden="true"/>Ajukan ke Controller</button>
    </div>:null}
    <div className="e2pay-funding-limits"><div className="e2pay-funding-section-head"><div><h3>Permintaan dan Alokasi Limit</h3><p>{pending.length} menunggu Controller · {active.length} limit aktif untuk klien terpilih.</p></div></div>
      {!selectedRequests.length?<div className="e2pay-funding-empty"><IconShieldCheck aria-hidden="true"/><div><strong>Belum ada pengajuan limit</strong><p>Payroll Processor dapat mengajukan limit untuk klien ini, kemudian Payroll Controller menyetujuinya.</p></div></div>:null}
      {selectedRequests.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th scope="col">Klien</th><th scope="col">Status</th><th scope="col" className="e2pay-funding-amount">Pengajuan</th><th scope="col" className="e2pay-funding-amount">Sisa limit</th><th scope="col">Tindakan</th></tr></thead><tbody>
      {selectedRequests.map(row=><tr key={row.id}>
        <td>{row.clientName||row.clientCode||row.clientId}</td><td><span className="e2pay-funding-status">{({PENDING_APPROVAL:'Menunggu persetujuan',ACTIVE:'Aktif',REJECTED:'Ditolak',REVOKED:'Dicabut',EXHAUSTED:'Habis',EXPIRED:'Kedaluwarsa'} as Record<string,string>)[row.status]||row.status}</span></td><td className="e2pay-funding-amount">{formatIDR(row.requestedAmount)}</td><td className="e2pay-funding-amount">{formatIDR(row.remainingAmount)}</td><td><div className="e2pay-funding-actions">
        {canApprove&&row.status==='PENDING_APPROVAL'?<>
          <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={()=>void respond(row.id,'APPROVE')}>Setujui</button>
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={()=>void respond(row.id,'REJECT')}>Tolak</button>
        </>:null}
        {canApprove&&row.status==='ACTIVE'?<button type="button" className="btn" disabled={Boolean(busy)} onClick={()=>void respond(row.id,'REVOKE')}>Cabut</button>:null}
        {!(canApprove&&['PENDING_APPROVAL','ACTIVE'].includes(row.status))?<span className="e2pay-funding-muted">—</span>:null}
      </div></td></tr>)}
      </tbody></table></div>:null}
    </div>
    <p className="e2pay-funding-footnote">Eksekusi pembayaran tetap melalui Payment Instruction yang telah disetujui.</p>
  </section>;
}
