'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatIDR } from '@/lib/format';
import { listOperatingResource } from '@/lib/operating-model-api';
import PanelPagination from '@/components/PanelPagination';

type PaymentReport = {
  id:string; client_name?:string; project_name?:string; payroll_period?:string; payment_period?:string;
  arrears_periods?:string[]; status:string; expected_total:number; paid_total:number; payment_date?:string;
  reconciliation_status?:string; difference?:number; employee_count?:number; proof_id?:string;
};

export default function ReportsWorkspace() {
  const [rows, setRows] = useState<PaymentReport[]>([]);
  const [period, setPeriod] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/me');
      const me = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(me.error || `HTTP ${response.status}`);
      const clientIds = me.user?.role === 'CLIENT_USER' ? (me.user.clientIds || []) : [undefined];
      const results = await Promise.all(clientIds.map((clientId:string|undefined) => listOperatingResource('payment-reports', clientId)));
      const merged = results.flatMap((result:any) => result.paymentReports || []);
      setRows([...new Map(merged.map((row:PaymentReport) => [row.id, row])).values()]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Gagal memuat laporan'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const periods = useMemo(() => [...new Set(rows.map((row) => row.payment_period).filter(Boolean))].sort().reverse(), [rows]);
  const filtered = rows.filter((row) => (period === 'ALL' || row.payment_period === period)
    && (status === 'ALL' || row.status === status)
    && (!query || [row.client_name,row.project_name,row.id].join(' ').toLowerCase().includes(query.toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 15));
  const visible = filtered.slice((page - 1) * 15, page * 15);
  const completed = filtered.filter((row) => row.status === 'COMPLETED');
  const paidTotal = completed.reduce((sum,row) => sum + Number(row.paid_total || 0), 0);
  const employees = completed.reduce((sum,row) => sum + Number(row.employee_count || 0), 0);

  function downloadCsv() {
    const header = ['Payment ID','Klien','Project','Periode Payroll','Periode Pembayaran','Periode Rapel','Karyawan','Nilai Payroll','Nilai Dibayar','Tanggal Bayar','Status','Rekonsiliasi','Selisih'];
    const csvRows = filtered.map((row) => [row.id,row.client_name,row.project_name,row.payroll_period,row.payment_period,(row.arrears_periods || []).join('|'),row.employee_count,row.expected_total,row.paid_total,row.payment_date,row.status,row.reconciliation_status,row.difference]
      .map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...csvRows].join('\n')], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href=url; anchor.download=`laporan-pembayaran-${period === 'ALL' ? 'semua-periode' : period}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <section>
    <div className="reports-heading"><div><h2>Laporan Pembayaran Gaji</h2><p>Hasil pembayaran periode berjalan, histori, rapel, bukti, dan rekonsiliasi.</p></div><button className="btn btn-primary" disabled={!filtered.length} onClick={downloadCsv}>Unduh CSV</button></div>
    <div className="report-summary-grid"><Summary label="Pembayaran selesai" value={String(completed.length)} /><Summary label="Total dibayarkan" value={formatIDR(paidTotal)} /><Summary label="Karyawan dibayar" value={String(employees)} /><Summary label="Perlu tindak lanjut" value={String(filtered.filter((row) => ['PAYMENT_EXCEPTION','PROOF_UPLOADED'].includes(row.status)).length)} /></div>
    <div className="card report-filter"><input value={query} placeholder="Cari klien, project, atau payment ID…" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><select value={period} onChange={(event) => { setPeriod(event.target.value); setPage(1); }}><option value="ALL">Semua periode pembayaran</option>{periods.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="ALL">Semua status</option>{[...new Set(rows.map((row) => row.status))].map((item) => <option key={item}>{item}</option>)}</select></div>
    {error ? <div className="directory-message">{error}</div> : null}
    {loading ? <div className="card directory-empty">Memuat laporan…</div> : !filtered.length ? <div className="card directory-empty">Belum ada hasil pembayaran pada filter ini.</div> : <>
      <div className="card report-table-wrap"><table className="report-table"><thead><tr><th>Klien / Project</th><th>Periode</th><th>Rapel</th><th>Karyawan</th><th>Nilai</th><th>Pembayaran</th><th>Status</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td><strong>{row.client_name || '-'}</strong><small>{row.project_name || row.id}</small></td><td><strong>Payroll {row.payroll_period || '-'}</strong><small>Bayar {row.payment_period || row.payroll_period || '-'}</small></td><td>{row.arrears_periods?.length ? row.arrears_periods.join(', ') : '-'}</td><td>{Number(row.employee_count || 0)}</td><td><strong>{formatIDR(Number(row.expected_total || 0))}</strong><small>Dibayar {formatIDR(Number(row.paid_total || 0))}</small></td><td><strong>{row.payment_date ? new Date(row.payment_date).toLocaleDateString('id-ID') : '-'}</strong><small>{row.reconciliation_status || 'Belum rekonsiliasi'}{row.difference ? ` · Selisih ${formatIDR(Number(row.difference))}` : ''}</small></td><td><span className={`report-status report-status-${row.status === 'COMPLETED' ? 'done' : row.status === 'PAYMENT_EXCEPTION' ? 'error' : 'progress'}`}>{row.status}</span>{row.proof_id ? <a className="report-proof-link" href={`/api/payment-proof?id=${encodeURIComponent(row.proof_id)}`} target="_blank" rel="noreferrer">Lihat bukti</a> : null}</td></tr>)}</tbody></table></div>
      <PanelPagination page={Math.min(page,pageCount)} pageCount={pageCount} total={filtered.length} label="pembayaran" onPage={setPage} />
    </>}
  </section>;
}

function Summary({label,value}:{label:string;value:string}) { return <div className="card report-summary"><span>{label}</span><strong>{value}</strong></div>; }
