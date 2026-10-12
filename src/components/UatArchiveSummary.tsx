'use client';
import {useEffect,useState} from 'react';
import {formatIDR} from '@/lib/format';
type Row={sourceDocumentId:string;amountIdr:number;archivedAt:string};
export default function UatArchiveSummary(){
 const [rows,setRows]=useState<Row[]>([]);const [message,setMessage]=useState('');const [loading,setLoading]=useState(true);
 useEffect(()=>{const controller=new AbortController();fetch('/api/uat-administrative-archives',{cache:'no-store',signal:controller.signal})
  .then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);setRows(body.records||[]);})
  .catch(err=>{if(err.name!=='AbortError')setMessage('Arsip UAT tidak dapat dimuat; verifikasi login dan hak akses.')})
  .finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort();},[]);
 return <section aria-label="UAT administrative payment archives" className="uat-archive-history">
  <strong>UAT dianggap selesai secara administratif</strong>
  <p>Disembunyikan dari antrean pembayaran aktif. Tidak dicatat sebagai pembayaran E2Pay yang terverifikasi, tidak ada bukti settlement, dan tidak dapat dieksekusi ulang.</p>
  {loading?<p>Memuat arsip…</p>:message?<p role="alert">{message}</p>:rows.length?<div className="ui-table-wrap"><table className="ui-data-table"><thead><tr><th>PI UAT</th><th>Nominal simulasi</th><th>Status</th></tr></thead><tbody>{rows.map(row=><tr key={row.sourceDocumentId}><td>{row.sourceDocumentId}</td><td>{formatIDR(row.amountIdr)}</td><td>Arsip UAT · bukan settlement provider</td></tr>)}</tbody></table></div>:<p>Tidak ada PI dalam arsip administratif UAT.</p>}
 </section>;
}
