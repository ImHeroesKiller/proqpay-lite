'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReportsWorkspace from './ReportsWorkspace';
import { formatIDR } from '@/lib/format';

type Actor = { email:string; role:string };

function dateLabel(value:string) {
  return value ? new Date(value).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '-';
}

function statusLabel(value:string) {
  const labels:Record<string,string> = {
    ISSUED:'Terbit',
    PARTIALLY_PAID:'Dibayar sebagian',
    PAID:'Lunas',
    OUTSTANDING:'Belum lunas',
    OVERDUE:'Lewat jatuh tempo',
  };
  return labels[String(value||'')] || String(value||'-').replaceAll('_',' ');
}

export default function ClientDocumentsWorkspace({actor}:{actor:Actor}) {
  const [invoices,setInvoices] = useState<any[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');

  const load = useCallback(async()=>{
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/billing',{credentials:'same-origin',cache:'no-store'});
      const body = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setInvoices(body.invoices || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dokumen invoice gagal dimuat');
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(()=>{void load();},[load]);

  const total = useMemo(()=>invoices.reduce((sum,row)=>sum+Number(row.total_amount||0),0),[invoices]);

  return <section style={{display:'grid',gap:18}}>
    <div className="control-tower-heading">
      <div><span>DOCUMENTS</span><h1>Documents & Reports</h1><p>Invoice, status tagihan, payroll register, payment history, dan dokumen hasil proses yang tersedia untuk akun Anda.</p></div>
      <button type="button" className="btn" onClick={()=>void load()}>Refresh</button>
    </div>

    <div className="report-summary-grid">
      <div className="card report-summary"><span>Invoice tersedia</span><strong>{invoices.length}</strong></div>
      <div className="card report-summary"><span>Total invoice</span><strong>{formatIDR(total)}</strong></div>
      <div className="card report-summary"><span>Lunas</span><strong>{invoices.filter((row)=>row.status==='PAID').length}</strong></div>
      <div className="card report-summary"><span>Perlu pembayaran</span><strong>{invoices.filter((row)=>['ISSUED','PARTIALLY_PAID'].includes(row.status)).length}</strong></div>
    </div>

    <section className="card" style={{padding:18}}>
      <div className="control-panel-title"><div><span>INVOICES</span><h2>Invoice & Tax Documents</h2></div><small>{invoices.length} dokumen</small></div>
      {error ? <div className="app-notice-bubble app-notice-error"><strong>Invoice belum dapat dimuat</strong><span>{error}</span></div> : null}
      {loading ? <div className="control-empty">Memuat invoice…</div> : invoices.length ? <div className="report-table-wrap"><table className="report-table">
        <thead><tr><th>Invoice</th><th>Periode</th><th>Nilai</th><th>Jatuh tempo</th><th>Status</th><th>Faktur pajak</th></tr></thead>
        <tbody>{invoices.map((row)=><tr key={row.id}>
          <td><strong>{row.invoice_number||'Invoice'}</strong><small>{row.client_name||row.company||'-'} · {row.project_name||'-'}</small></td>
          <td>{row.period||'-'}</td>
          <td><strong>{formatIDR(Number(row.total_amount||0))}</strong></td>
          <td>{dateLabel(row.due_date)}</td>
          <td><span className="stage-pill">{statusLabel(row.status)}</span></td>
          <td>{row.tax_invoice_number ? <><strong>{row.tax_invoice_number}</strong><small>{dateLabel(row.tax_invoice_date)}</small></> : row.tax_status==='NON_PKP' ? 'Non-PKP' : 'Belum tersedia'}</td>
        </tr>)}</tbody>
      </table></div> : <div className="control-empty">Belum ada invoice yang diterbitkan untuk akun ini.</div>}
    </section>

    <section>
      <div className="control-panel-title"><div><span>REPORTS</span><h2>Payroll & Payment Reports</h2></div><small>{actor.email}</small></div>
      <ReportsWorkspace clientMode />
    </section>
  </section>;
}
