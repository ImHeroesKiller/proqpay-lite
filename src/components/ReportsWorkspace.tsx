'use client';

import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { formatIDR } from '@/lib/format';
import PanelPagination from '@/components/PanelPagination';
import PayrollSourceUpload from '@/components/PayrollSourceUpload';
import {
  REPORT_COLUMNS,
  REPORT_REPORT_LABELS,
  isMoneyColumn,
  reportColumnLabel,
  reportPrimaryTitle,
  reportSecondaryTitle,
  reportStatusLabel,
  reportStatusTone,
  type PaymentReport,
  type ReportFacets,
  type ReportRow,
  type ReportType,
} from '@/lib/report-ui';

function csvCell(value: unknown) {
  const raw = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return `"${raw.replaceAll('"','""')}"`;
}
function downloadRows(name:string, rows:Record<string,unknown>[]) {
  if (!rows.length) return;
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const body = [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\n');
  const blob = new Blob([body], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href=url; anchor.download=name; anchor.click(); URL.revokeObjectURL(url);
}

async function loadAllPayrollReport(type:Exclude<ReportType,'payments'>, filters:{period:string;status:string;query:string}) {
  const rows:ReportRow[]=[];
  let facets:ReportFacets={periods:[],statuses:[]};
  let offset=0;
  for(let page=0;page<1000;page+=1){
    const params=new URLSearchParams({type,offset:String(offset),limit:'500'});
    if(filters.period!=='ALL') params.set('period',filters.period);
    if(filters.status!=='ALL') params.set('status',filters.status);
    if(filters.query) params.set('q',filters.query);
    const response=await fetch(`/api/payroll-reports?${params.toString()}`,{cache:'no-store'});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||`HTTP ${response.status}`);
    rows.push(...(Array.isArray(payload.rows)?payload.rows:[]));
    if(page===0&&payload.facets) facets={
      periods:Array.isArray(payload.facets.periods)?payload.facets.periods:[],
      statuses:Array.isArray(payload.facets.statuses)?payload.facets.statuses:[],
    };
    const next=payload?.meta?.nextOffset;
    if(next==null) return {rows,facets};
    offset=Number(next);
    if(!Number.isFinite(offset)||offset<0) throw new Error('Metadata pagination laporan tidak valid');
  }
  throw new Error('Pagination laporan melebihi batas aman');
}

async function loadAllPaymentReports(filters:{period:string;status:string;query:string}) {
  const rows:PaymentReport[]=[];
  let facets:{periods:string[];statuses:string[]}={periods:[],statuses:[]};
  let offset=0;
  for(let page=0;page<1000;page+=1){
    const params=new URLSearchParams({resource:'payment-reports',offset:String(offset),limit:'500'});
    if(filters.period!=='ALL') params.set('period',filters.period);
    if(filters.status!=='ALL') params.set('status',filters.status);
    if(filters.query) params.set('q',filters.query);
    const response=await fetch(`/api/operating-model?${params.toString()}`,{headers:{Accept:'application/json'},cache:'no-store'});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||`HTTP ${response.status}`);
    rows.push(...(Array.isArray(payload.paymentReports)?payload.paymentReports:[]));
    if(page===0&&payload.paymentReportFacets) facets={
      periods:Array.isArray(payload.paymentReportFacets.periods)?payload.paymentReportFacets.periods:[],
      statuses:Array.isArray(payload.paymentReportFacets.statuses)?payload.paymentReportFacets.statuses:[],
    };
    const next=payload?.paymentReportsMeta?.nextOffset;
    if(next==null) return {rows:[...new Map(rows.map((row)=>[row.id,row])).values()],facets};
    offset=Number(next);
    if(!Number.isFinite(offset)||offset<0) throw new Error('Metadata pagination pembayaran tidak valid');
  }
  throw new Error('Pagination pembayaran melebihi batas aman');
}

export default function ReportsWorkspace({clientMode=false}:Props = {}) {
  const [type,setType] = useState<ReportType>('payments');
  const [paymentRows, setPaymentRows] = useState<PaymentReport[]>([]);
  const [payrollRows,setPayrollRows] = useState<ReportRow[]>([]);
  const [period, setPeriod] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [facets,setFacets]=useState<ReportFacets>({periods:[],statuses:[]});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const filters={period,status,query:deferredQuery};
      if (type === 'payments') {
        const result=await loadAllPaymentReports(filters);
        setPaymentRows(result.rows);
        setFacets(result.facets);
      } else {
        const result=await loadAllPayrollReport(type,filters);
        setPayrollRows(result.rows);
        setFacets(result.facets);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal memuat laporan');
    } finally {
      setLoading(false);
    }
  }, [type,period,status,deferredQuery]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); setQuery(''); setStatus('ALL'); setPeriod('ALL'); }, [type]);

  const periods = facets.periods;
  const statusOptions = facets.statuses;
  const activeRows:Array<PaymentReport|ReportRow> = type === 'payments' ? paymentRows : payrollRows;
  const filteredPayments = paymentRows;
  const filteredPayroll = payrollRows;
  const pageCount = Math.max(1, Math.ceil(activeRows.length / 15));
  const visible = activeRows.slice((page - 1) * 15, page * 15);
  const completed = filteredPayments.filter((row) => row.status === 'COMPLETED' && row.settlement_source !== 'CONFLICT');
  const settlementConflicts = filteredPayments.filter((row)=>row.settlement_source === 'CONFLICT');
  const paidTotal = completed.reduce((sum,row) => sum + Number(row.paid_total || 0), 0);
  const employees = completed.reduce((sum,row) => sum + Number(row.employee_count || 0), 0);

  const reportTypes:ReportType[] = clientMode ? ['payments','register','payslips'] : (Object.keys(REPORT_LABELS) as ReportType[]);

  function exportCurrent() {
    if (type === 'payments') {
      const rows = filteredPayments.map((row) => ({ payment_id:row.id,client:row.client_name,project:row.project_name,payroll_period:row.payroll_period,payment_period:row.payment_period,arrears:(row.arrears_periods||[]).join('|'),employees:row.employee_count,expected_total:row.expected_total,settlement_source:row.settlement_source,manual_proof_total:row.manual_proof_total,gateway_total:row.gateway_total,paid_total:row.paid_total,payment_date:row.payment_date,status:row.status,reconciliation:row.reconciliation_status,difference:row.difference }));
      downloadRows(`payment-report-${period === 'ALL' ? 'all' : period}.csv`,rows);
    } else downloadRows(`${type}-${period === 'ALL' ? 'all' : period}.csv`, filteredPayroll);
  }

  return <section>
    {!clientMode ? <PayrollSourceUpload /> : null}
    <div className="reports-heading"><div><h2>{clientMode?'Reports':'Payroll & Payment Reports'}</h2><p>{clientMode?'Laporan payroll dan pembayaran yang tersedia untuk scope akun Anda.':'Audit trail dari raw source, canonical payroll snapshot, payslip final, pembayaran dan rekonsiliasi.'}</p></div><button className="btn btn-primary" disabled={!activeRows.length} onClick={exportCurrent}>Unduh CSV</button></div>
    <div className="report-type-tabs">{reportTypes.map((item)=><button key={item} type="button" className={`btn ${type===item?'btn-primary':''}`} onClick={()=>setType(item)}>{clientMode&&item==='payments'?'Payment History':REPORT_LABELS[item]}</button>)}</div>

    {type === 'payments' ? <div className="report-summary-grid"><Summary label="Pembayaran selesai" value={String(completed.length)} /><Summary label="Total dibayarkan" value={formatIDR(paidTotal)} /><Summary label="Karyawan dibayar" value={String(employees)} /><Summary label="Perlu tindak lanjut" value={String(filteredPayments.filter((row) => ['PAYMENT_EXCEPTION','PROOF_UPLOADED'].includes(row.status)).length + settlementConflicts.length)} /></div>
      : type === 'control' ? <div className="report-summary-grid"><Summary label="Pay Run" value={String(filteredPayroll.length)} /><Summary label="Balanced" value={String(filteredPayroll.filter((row)=>Number(row.payroll_gross||0)-Number(row.payroll_deduction||0)===Number(row.payroll_net||0)).length)} /><Summary label="PI mismatch" value={String(filteredPayroll.filter((row)=>Number(row.pi_total||0)&&Number(row.pi_total)!==Number(row.payroll_net||0)).length)} /><Summary label="Reconciliation diff" value={String(filteredPayroll.filter((row)=>Number(row.reconciliation_difference||0)!==0).length)} /></div>
      : <div className="report-summary-grid"><Summary label={REPORT_LABELS[type]} value={String(filteredPayroll.length)} /><Summary label="Periode" value={period==='ALL'?'Semua':period} /><Summary label="Source linked" value={String(filteredPayroll.filter((row)=>row.source_batch_id || row.file_sha256).length)} /><Summary label="Rows displayed" value={String(activeRows.length)} /></div>}

    <div className="card report-filter"><input value={query} placeholder="Cari employee, klien, project, batch, submission…" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><select value={period} onChange={(event) => { setPeriod(event.target.value); setPage(1); }}><option value="ALL">Semua periode</option>{periods.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="ALL">Semua status</option>{statusOptions.map((item) => <option key={item} value={item}>{reportStatusLabel(item)}</option>)}</select></div>
    {error ? <div className="card report-error" role="alert"><span>{error}</span><button type="button" className="btn" disabled={loading} onClick={()=>void load()}>{loading?'Memuat…':'Coba lagi'}</button></div> : null}
    {loading ? <div className="card directory-empty">Memuat laporan…</div> : !activeRows.length ? <div className="card directory-empty">Belum ada data pada filter ini.</div> : <>
      {type === 'payments' ? <PaymentTable rows={visible as PaymentReport[]} /> : <GenericTable rows={visible as ReportRow[]} type={type} />}
      <PanelPagination page={Math.min(page,pageCount)} pageCount={pageCount} total={activeRows.length} label="baris" onPage={setPage} />
    </>}
  </section>;
}

function PaymentTable({rows}:{rows:PaymentReport[]}) {
  return <div className="card report-table-wrap">
    <table className="report-table report-desktop-table"><thead><tr><th>Klien / Project</th><th>Periode</th><th>Karyawan</th><th>Nilai</th><th>Pembayaran</th><th>Status</th></tr></thead><tbody>{rows.map((row)=>{
      const conflict=row.settlement_source==='CONFLICT';
      return <tr key={row.id}><td><strong>{row.client_name||'-'}</strong><small>{row.project_name||row.id}</small></td><td><strong>{row.payroll_period||'-'}</strong><small>Bayar {row.payment_period||'-'}</small></td><td>{Number(row.employee_count||0)}</td><td><strong>{formatIDR(Number(row.expected_total||0))}</strong><small>{conflict?`Manual ${formatIDR(Number(row.manual_proof_total||0))} · Gateway ${formatIDR(Number(row.gateway_total||0))}`:`Dibayar ${formatIDR(Number(row.paid_total||0))}`}</small></td><td>{conflict?'Konflik sumber settlement':row.payment_date?new Date(row.payment_date).toLocaleDateString('id-ID'):'-'}<small>{row.reconciliation_status||'Belum rekonsiliasi'}{row.difference?` · ${formatIDR(Number(row.difference))}`:''}</small></td><td><span className={`report-status report-status-${reportStatusTone(conflict?'SETTLEMENT_CONFLICT':row.status)}`}>{reportStatusLabel(conflict?'SETTLEMENT_CONFLICT':row.status)}</span></td></tr>;
    })}</tbody></table>
    <div className="report-mobile-list">{rows.map((row)=>{
      const conflict=row.settlement_source==='CONFLICT';
      return <article className="report-mobile-card" key={row.id}>
        <div className="report-mobile-head"><div><strong>{row.client_name||'-'}</strong><small>{row.project_name||row.id}</small></div><span className={`report-status report-status-${reportStatusTone(conflict?'CONFLICT':row.status)}`}>{reportStatusLabel(conflict?'CONFLICT':row.status)}</span></div>
        <div className="report-mobile-grid"><div><span>Periode</span><strong>{row.payment_period||row.payroll_period||'-'}</strong></div><div><span>Karyawan</span><strong>{Number(row.employee_count||0)}</strong></div><div><span>Nilai</span><strong>{formatIDR(Number(row.expected_total||0))}</strong></div><div><span>Dibayar</span><strong>{conflict?'Periksa sumber':formatIDR(Number(row.paid_total||0))}</strong></div></div>
      </article>;
    })}</div>
  </div>;
}

function GenericTable({rows,type}:{rows:ReportRow[];type:Exclude<ReportType,'payments'>}) {
  const columns=REPORT_COLUMNS[type].filter((key)=>rows.some((row)=>key in row));
  const primaryKeys=columns.slice(0,6);
  return <div className="card report-table-wrap">
    <table className="report-table report-desktop-table"><thead><tr>{columns.map((key)=><th key={key}>{reportColumnLabel(key)}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={`${String(row.submission_id||row.id||'row')}-${String(row.employee_id||index)}-${index}`}>{columns.map((key)=>{
      const value=row[key];
      if(key==='status'||key==='state'||key==='payment_status'||key==='reconciliation_status') return <td key={key}><span className={`report-status report-status-${reportStatusTone(value)}`}>{reportStatusLabel(value)}</span></td>;
      return <td key={key}>{typeof value==='number'&&isMoneyColumn(key)?formatIDR(value):typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'-')}</td>;
    })}</tr>)}</tbody></table>
    <div className="report-mobile-list">{rows.map((row,index)=><article className="report-mobile-card" key={`mobile-${String(row.submission_id||row.id||index)}-${index}`}><div className="report-mobile-head"><div><strong>{reportPrimaryTitle(row)}</strong><small>{reportSecondaryTitle(row)}</small></div>{(row.status||row.state||row.payment_status)?<span className={`report-status report-status-${reportStatusTone(row.status||row.state||row.payment_status)}`}>{reportStatusLabel(row.status||row.state||row.payment_status)}</span>:null}</div><div className="report-mobile-grid">{primaryKeys.map((key)=>{
      const value=row[key];
      return <div key={key}><span>{reportColumnLabel(key)}</span><strong>{typeof value==='number'&&isMoneyColumn(key)?formatIDR(value):String(value??'-')}</strong></div>;
    })}</div></article>)}</div>
  </div>;
}

function Summary({label,value}:{label:string;value:string}) { return <div className="card report-summary"><span>{label}</span><strong>{value}</strong></div>; }
