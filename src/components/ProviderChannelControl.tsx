'use client';

import {useCallback,useEffect,useState} from 'react';
import {IconRefresh,IconCheckCircle,IconAlertTriangle} from '@/components/Icons';
import {parseApiResponse} from '@/lib/api-client';

type Route={purpose:string;destinationMode:string;beneficiaryType:string;ready:boolean;reason:string|null};
type Routing={routingMode:'AUTOMATIC';environment:string;routes:Route[]};
const labels:Record<string,{label:string;description:string}>={
  'PAYROLL:DIRECT_EMPLOYEE':{label:'Payroll → Rekening Karyawan',description:'Rekening setiap karyawan diambil dari snapshot Payment Instruction.'},
  'PAYROLL:CLIENT_ACCOUNT':{label:'Payroll → Rekening Perusahaan Klien',description:'Total payroll ditransfer ke rekening perusahaan klien yang telah diverifikasi.'},
  'EWA:DIRECT_EMPLOYEE':{label:'EWA → Rekening Karyawan',description:'Rekening penerima dan nominal diambil dari pengajuan EWA.'},
};

export default function ProviderChannelControl({role}:{role:string}){
  const [routing,setRouting]=useState<Routing|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/provider-channel-mappings?provider=E2PAY',{headers:{Accept:'application/json'},cache:'no-store'});
      const data=await parseApiResponse<Routing>(response);
      if(data.routingMode!=='AUTOMATIC'||!Array.isArray(data.routes))throw new Error('Versi konfigurasi berubah. Refresh halaman, lalu periksa kembali.');
      setRouting(data);
    }catch(cause){setRouting(null);setError(cause instanceof Error?cause.message:'Jalur pembayaran belum dapat diperiksa');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  return <section className="e2pay-funding e2pay-routing" aria-label="Jalur Pembayaran Otomatis" aria-busy={loading}>
    <div className="ui-section-card-head"><div><span className="workspace-eyebrow">E2PAY MASTER</span><h2>Jalur Pembayaran Otomatis</h2><p>Pilih tujuan saat menyiapkan pembayaran. Rekening dan konfigurasi transfer diambil otomatis oleh sistem.</p></div>
      <button type="button" className="btn" disabled={loading} onClick={()=>void load()}><IconRefresh aria-hidden="true"/>{loading?'Memeriksa…':'Periksa Koneksi'}</button>
    </div>
    {error?<p role="alert" className="ui-notice">{error}</p>:null}
    {routing?<>
      <div className="e2pay-routing-context"><span className="e2pay-funding-environment">{routing.environment}</span><p>Satu Master Account untuk seluruh tujuan.{routing.environment==='UAT'?' Lingkungan pengujian E2Pay.':''}</p></div>
      <ul className="e2pay-routing-list">{routing.routes.map(route=>{
        const info=labels[`${route.purpose}:${route.destinationMode}`];
        return <li key={`${route.purpose}:${route.destinationMode}`}><div><h3>{info?.label||route.purpose}</h3><p>{info?.description}</p></div>
          <span className={`e2pay-funding-check ${route.ready?'is-ready':'needs-action'}`}>{route.ready?<IconCheckCircle aria-hidden="true"/>:<IconAlertTriangle aria-hidden="true"/>}{route.ready?'Konfigurasi Master tervalidasi':'Periksa konfigurasi Master'}</span>
        </li>;
      })}</ul>
      <p className="e2pay-funding-footnote">Tidak perlu mengisi kode channel atau referensi konfirmasi. Rekening tetap divalidasi melalui inquiry E2Pay; saldo terbaru, limit aktif, dan persetujuan Controller diperiksa sebelum pembayaran.</p>
      {role==='SUPER_ADMIN'?<p className="e2pay-funding-footnote">Jika koneksi belum tervalidasi, periksa konfigurasi pusat dan aktivasi Master di Saldo &amp; Disbursement Limit.</p>:null}
    </>:null}
  </section>;
}
