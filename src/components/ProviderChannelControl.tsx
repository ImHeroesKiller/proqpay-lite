'use client';

import {useCallback,useEffect,useState} from 'react';

type Environment='UAT'|'PRODUCTION';
type Intent={purpose:'PAYROLL'|'EWA';destinationMode:'DIRECT_EMPLOYEE'|'CLIENT_ACCOUNT';beneficiaryType:'EMPLOYEE'|'CORPORATE';label:string};
type Mapping={id:string;provider:string;environment:string;purpose:string;destinationMode:string;beneficiaryType:string;providerChannel:string|null;status:string;contractVersion:string;confirmationReference:string|null;confirmedAt:string|null;confirmedBy:string|null;configHash:string|null};
const INTENTS:Intent[]=[
  {purpose:'PAYROLL',destinationMode:'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE',label:'Payroll → Rekening Karyawan'},
  {purpose:'PAYROLL',destinationMode:'CLIENT_ACCOUNT',beneficiaryType:'CORPORATE',label:'Payroll → Rekening Perusahaan Klien'},
  {purpose:'EWA',destinationMode:'DIRECT_EMPLOYEE',beneficiaryType:'EMPLOYEE',label:'EWA → Rekening Karyawan'},
];
const mappingKey=(row:Pick<Mapping,'purpose'|'destinationMode'|'beneficiaryType'>)=>`${row.purpose}:${row.destinationMode}:${row.beneficiaryType}`;

export default function ProviderChannelControl({role}:{role:string}){
  const [environment,setEnvironment]=useState<Environment>('UAT');
  const [mappings,setMappings]=useState<Mapping[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Intent|null>(null);
  const [providerChannel,setProviderChannel]=useState('');
  const [contractVersion,setContractVersion]=useState('1');
  const [confirmationReference,setConfirmationReference]=useState('');
  const canManage=role==='SUPER_ADMIN';

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const response=await fetch(`/api/provider-channel-mappings?provider=E2PAY&environment=${environment}`,{headers:{Accept:'application/json'},cache:'no-store'});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
      setMappings(Array.isArray(payload.mappings)?payload.mappings:[]);
    }catch(cause){setMappings([]);setError(cause instanceof Error?cause.message:'Provider channel tidak dapat diverifikasi');}
    finally{setLoading(false);}
  },[environment]);
  useEffect(()=>{void load();},[load]);
  const active=mappings.filter(row=>row.status==='ACTIVE'&&Boolean(row.confirmationReference)&&Boolean(row.configHash));
  const select=(intent:Intent)=>{
    const current=mappings.find(row=>mappingKey(row)===mappingKey(intent));
    setSelected(intent);setProviderChannel(current?.providerChannel||'');setContractVersion(current?.contractVersion||'1');setConfirmationReference(current?.confirmationReference||'');setError('');
  };
  async function submit(action:'SAVE_DRAFT'|'ACTIVATE_MAPPING'|'DEACTIVATE_MAPPING'){
    if(!selected||busy||!canManage)return;
    if(action==='ACTIVATE_MAPPING'&&(!providerChannel.trim()||!confirmationReference.trim())){
      setError('Aktivasi memerlukan kode channel yang dikonfirmasi E2Pay dan referensi konfirmasi resmi.');return;
    }
    const prompt=action==='ACTIVATE_MAPPING'
      ?`Aktivasi ${environment} untuk ${selected.label} dengan kode ${providerChannel.trim()} dan referensi ${confirmationReference.trim()}? Hanya gunakan data yang dikonfirmasi E2Pay.`
      :action==='DEACTIVATE_MAPPING'?`Nonaktifkan channel ${selected.label} pada ${environment}? Execution baru akan fail-closed.`:null;
    const current=mappings.find(row=>mappingKey(row)===mappingKey(selected));
    if(action==='SAVE_DRAFT'&&current?.status==='ACTIVE'&&!window.confirm('Menyimpan draft akan MENONAKTIFKAN mapping ACTIVE saat ini. Execution baru pada intent ini akan diblokir. Lanjut?'))return;
    if(prompt&&!window.confirm(prompt))return;
    if(environment==='PRODUCTION'&&window.prompt('Konfirmasi perubahan routing produksi. Ketik UBAH ROUTING PRODUKSI:')!=='UBAH ROUTING PRODUKSI')return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/provider-channel-mappings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,provider:'E2PAY',environment,...selected,providerChannel:providerChannel.trim(),contractVersion:contractVersion.trim()||'1',confirmationReference:confirmationReference.trim()})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
      setSelected(null);await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'Gagal menyimpan channel provider');}
    finally{setBusy(false);}
  }
  return <section className="card provider-channel-control" aria-label="Provider Channel Mapping">
    <header className="provider-channel-head"><div><span className="page-eyebrow">PROVIDER ROUTING · E2PAY</span><h3>Channel Mapping & Provider Evidence</h3><p>Hanya channel yang sudah dikonfirmasi E2Pay dapat ACTIVE. Mapping kosong/tidak terkonfirmasi tetap memblokir execution baru.</p></div><label>Environment<select value={environment} onChange={event=>{setEnvironment(event.target.value as Environment);setSelected(null);}}><option value="UAT">UAT</option><option value="PRODUCTION">Production</option></select></label></header>
    <div className="provider-channel-summary"><strong>{loading?'—':active.length} / {INTENTS.length} confirmed & ACTIVE</strong><span>{environment} · Konfigurasi provider global</span><button type="button" className="btn" disabled={loading||busy} onClick={()=>void load()}>Refresh</button></div>
    {error?<div role="alert" className="app-notice-bubble app-notice-error"><span>{error}</span></div>:null}
    <div className="provider-channel-list">{INTENTS.map(intent=>{
      const current=mappings.find(row=>mappingKey(row)===mappingKey(intent));
      const confirmed=Boolean(current?.status==='ACTIVE'&&current.confirmationReference&&current.configHash);
      return <div className="provider-channel-row" key={mappingKey(intent)}>
        <div><strong>{intent.label}</strong><small>{current?.providerChannel||'Belum ada kode provider'} · {current?.status||'NOT_CONFIGURED'}</small>{confirmed?<small>Confirmed {current?.confirmedAt||'—'} · {current?.confirmationReference}</small>:<small>Belum terkonfirmasi; tidak siap untuk eksekusi.</small>}</div>
        <span className={`ui-status-badge ${confirmed?'ui-status-success':'ui-status-warning'}`}>{confirmed?'ACTIVE · Confirmed':'Not Ready'}</span>
        {canManage?<button type="button" className="btn" disabled={busy} onClick={()=>select(intent)}>Kelola</button>:null}
      </div>;
    })}</div>
    {canManage&&selected?<div className="provider-channel-editor"><div><strong>Konfigurasi {selected.label}</strong><small>{environment} · Jangan memasukkan kode channel berdasarkan asumsi.</small></div><div className="provider-channel-form"><label>Provider channel code<input value={providerChannel} maxLength={180} onChange={event=>setProviderChannel(event.target.value)} placeholder="Kode resmi dari E2Pay" /></label><label>Contract version<input value={contractVersion} maxLength={40} onChange={event=>setContractVersion(event.target.value)} /></label><label>Referensi konfirmasi E2Pay<input value={confirmationReference} maxLength={300} onChange={event=>setConfirmationReference(event.target.value)} placeholder="Nomor tiket/email konfirmasi provider" /></label></div><div className="provider-channel-actions"><button type="button" className="btn" disabled={busy} onClick={()=>setSelected(null)}>Batal</button><button type="button" className="btn" disabled={busy} onClick={()=>void submit('SAVE_DRAFT')}>Simpan Draft</button>{mappings.some(row=>mappingKey(row)===mappingKey(selected))?<button type="button" className="btn" disabled={busy} onClick={()=>void submit('DEACTIVATE_MAPPING')}>Nonaktifkan</button>:null}<button type="button" className="btn btn-primary" disabled={busy||!providerChannel.trim()||!confirmationReference.trim()} onClick={()=>void submit('ACTIVATE_MAPPING')}>Aktifkan dengan bukti provider</button></div></div>:null}
    <small className="provider-channel-footnote">Aktivasi mengubah routing transaksi berikutnya dan wajib disertai bukti konfirmasi E2Pay. Snapshot DR yang sudah dibuat tidak diubah.</small>
  </section>;
}
