'use client';

import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { formatIDR } from '@/lib/format';
import PanelPagination from '@/components/PanelPagination';
import {
  REPORT_COLUMNS,
  REPORT_LABELS,
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

type Props = { clientMode?: boolean; hideHeading?: boolean };

const MOBILE_FIELDS:Record<Exclude<ReportType,'payments'>,string[]>={
  register:['period','employee_id','gross_amount','deduction_amount','net_amount','state'],
  control:['period','employee_count','payroll_net','pi_total','reconciliation_difference','state'],
  uploads:['period','original_filename','accepted_row_count','source_total_net','status','uploaded_by'],
  payslips:['period','employee_id','net_amount','document_no','payment_status','reconciliation_status'],
  exceptions:['period','employee_id','severity','code','status','message'],
};

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

export default function ReportsWorkspace({clientMode=false,hideHeading=false}:Props = {}) {
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
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId=++loadRequestRef.current;
    setLoading(true); setError('');
    try {
      const filters={period,status,query:deferredQuery};
      if (type === 'payments') {
        const result=await loadAllPaymentReports(filters);
        if(requestId!==loadRequestRef.current) return;
        setPaymentRows(result.rows);
        setFacets(result.facets);
      } else {
        const result=await loadAllPayrollReport(type,filters);
        if(requestId!==loadRequestRef.current) return;
        setPayrollRows(result.rows);
        setFacets(result.facets);
      }
    } catch (caught) {
      if(requestId!==loadRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Gagal memuat laporan');
    } finally {
      if(requestId===loadRequestRef.current) setLoading(false);
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

  const filtersActive = Boolean(query.trim() || period !== 'ALL' || status !== 'ALL');
  const reportTypes:ReportType[] = clientMode ? ['payments','register','payslips'] : (Object.keys(REPORT_LABELS) as ReportType[]);

  function resetFilters() {
    setQuery('');
    setPeriod('ALL');
    setStatus('ALL');
    setPage(1);
  }

  function exportCurrent() {
    if (type === 'payments') {
      const rows = filteredPayments.map((row) => ({ payment_id:row.id,client:row.client_name,project:row.project_name,payroll_period:row.payroll_period,payment_period:row.payment_period,arrears:(row.arrears_periods||[]).join('|'),employees:row.employee_count,expected_total:row.expected_total,settlement_source:row.settlement_source,manual_proof_total:row.manual_proof_total,gateway_total:row.gateway_total,paid_total:row.paid_total,payment_date:row.payment_date,status:row.status,reconciliation:row.reconciliation_status,difference:row.difference }));
      downloadRows(`payment-report-${period === 'ALL' ? 'all' : period}.csv`,rows);
    } else downloadRows(`${type}-${period === 'ALL' ? 'all' : period}.csv`, filteredPayroll);
  }

  return <section className="reports-workspace">
    {!hideHeading ? <div className="reports-heading"><div><span className="workspace-eyebrow">{clientMode?'REPORTS':'REPORTING & AUDIT'}</span><h2>{clientMode?'Payroll & Payment Reports':'Laporan Payroll & Pembayaran'}</h2><p>{clientMode?'Laporan payroll dan pembayaran sesuai scope akun Anda.':'Jejak audit dari sumber payroll, snapshot final, slip gaji, pembayaran, dan rekonsiliasi.'}</p></div><button className="btn report-export-btn" disabled={!activeRows.length} onClick={exportCurrent}>Unduh CSV</button></div> : <div className="reports-inline-actions"><button className="btn report-export-btn" disabled={!activeRows.length} onClick={exportCurrent}>Unduh CSV</button></div>}
    <div className="report-type-tabs">{reportTypes.map((item)=><button key={item} type="button" className={`btn ${type===item?'btn-primary':''}`} onClick={()=>setType(item)}>{clientMode&&item==='payments'?'Riwayat Pembayaran':REPORT_LABELS[item]}</button>)}</div>

    {type === 'payments' ? <div className="report-summary-grid"><Summary label="Pembayaran selesai" value={String(completed.length)} /><Summary label="Total dibayarkan" value={formatIDR(paidTotal)} /><Summary label="Karyawan dibayar" value={String(employees)} /><Summary label="Perlu tindak lanjut" value={String(filteredPayments.filter((row) => ['PAYMENT_EXCEPTION','PROOF_UPLOADED'].includes(row.status)).length + settlementConflicts.length)} /></div>
      : type === 'control' ? <div className="report-summary-grid"><Summary label="Pay Run" value={String(filteredPayroll.length)} /><Summary label="Sesuai kontrol" value={String(filteredPayroll.filter((row)=>Number(row.payroll_gross||0)-Number(row.payroll_deduction||0)===Number(row.payroll_net||0)).length)} /><Summary label="Selisih PI" value={String(filteredPayroll.filter((row)=>Number(row.pi_total||0)&&Number(row.pi_total)!==Number(row.payroll_net||0)).length)} /><Summary label="Selisih rekonsiliasi" value={String(filteredPayroll.filter((row)=>Number(row.reconciliation_difference||0)!==0).length)} /></div>
      : <div className="report-summary-grid"><Summary label={REPORT_LABELS[type]} value={String(filteredPayroll.length)} /><Summary label="Periode" value={period==='ALL'?'Semua':period} /><Summary label="Terhubung ke sumber" value={String(filteredPayroll.filter((row)=>row.source_batch_id || row.file_sha256).length)} /><Summary label="Baris ditampilkan" value={String(activeRows.length)} /></div>}

    <div className="card report-filter"><label><span>Cari</span><input value={query} placeholder="Cari karyawan, klien, project, batch, pay run…" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label><label><span>Periode</span><select value={period} onChange={(event) => { setPeriod(event.target.value); setPage(1); }}><option value="ALL">Semua periode</option>{periods.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="ALL">Semua status</option>{statusOptions.map((item) => <option key={item} value={item}>{reportStatusLabel(item)}</option>)}</select></label><button type="button" className="btn report-reset-btn" disabled={!filtersActive} onClick={resetFilters}>Reset</button></div>
    {error ? <div className="card report-error" role="alert"><span>{error}</span><button type="button" className="btn" disabled={loading} onClick={()=>void load()}>{loading?'Memuat…':'Coba lagi'}</button></div> : null}
    {loading ? <div className="card directory-empty report-loading" role="status">Memuat laporan…</div> : !activeRows.length ? <div className="card directory-empty report-empty"><span>{filtersActive?'Tidak ada data yang cocok dengan filter ini.':'Belum ada data laporan.'}</span>{filtersActive?<button type="button" className="btn" onClick={resetFilters}>Reset filter</button>:null}</div> : <>
      {type === 'payments' ? <PaymentTable rows={visible as PaymentReport[]} /> : <GenericTable rows={visible as ReportRow[]} type={type} />}
      <PanelPagination page={Math.min(page,pageCount)} pageCount={pageCount} total={activeRows.length} label="baris" onPage={setPage} />
    </>}
  </section>;
}

function PaymentTable({rows}:{rows:PaymentReport[]}) {
  return <div className="card report-table-wrap">
    <table className="report-table report-desktop-table report-payment-table"><thead><tr><th className="report-sticky-col">Klien / Project</th><th>Periode</th><th className="report-num">Karyawan</th><th className="report-num">Expected</th><th className="report-num">Dibayar</th><th className="report-num">Selisih</th><th>Pembayaran</th><th>Status</th></tr></thead><tbody>{rows.map((row)=>{
      const conflict=row.settlement_source==='CONFLICT';
      const difference=conflict?null:Number(row.expected_total||0)-Number(row.paid_total||0);
      return <tr key={row.id}><td className="report-sticky-col"><strong>{row.client_name||'-'}</strong><small>{row.project_name||row.id}</small></td><td><strong>{row.payroll_period||'-'}</strong><small>Bayar {row.payment_period||'-'}</small></td><td className="report-num">{Number(row.employee_count||0)}</td><td className="report-num"><strong>{formatIDR(Number(row.expected_total||0))}</strong></td><td className="report-num"><strong>{conflict?'Periksa sumber':formatIDR(Number(row.paid_total||0))}</strong>{conflict?<small>Manual {formatIDR(Number(row.manual_proof_total||0))} · Gateway {formatIDR(Number(row.gateway_total||0))}</small>:null}</td><td className="report-num">{difference==null?'-':formatIDR(difference)}</td><td>{conflict?'Konflik sumber settlement':row.payment_date?new Date(row.payment_date).toLocaleDateString('id-ID'):'-'}<small>{row.reconciliation_status||'Belum rekonsiliasi'}{row.difference?` · ${formatIDR(Number(row.difference))}`:''}</small></td><td><span className={`report-status report-status-${reportStatusTone(conflict?'SETTLEMENT_CONFLICT':row.status)}`}>{reportStatusLabel(conflict?'SETTLEMENT_CONFLICT':row.status)}</span></td></tr>;
    })}</tbody></table>
    <div className="report-mobile-list">{rows.map((row)=>{
      const conflict=row.settlement_source==='CONFLICT';
      return <article className="report-mobile-card" key={row.id}>
        <div className="report-mobile-head"><div><strong>{row.client_name||'-'}</strong><small>{row.project_name||row.id}</small></div><span className={`report-status report-status-${reportStatusTone(conflict?'CONFLICT':row.status)}`}>{reportStatusLabel(conflict?'CONFLICT':row.status)}</span></div>
        <div className="report-mobile-grid"><MobileValue label="Periode" value={row.payment_period||row.payroll_period||'-'} /><MobileValue label="Karyawan" value={Number(row.employee_count||0)} /><MobileValue label="Expected" value={formatIDR(Number(row.expected_total||0))} /><MobileValue label="Dibayar" value={conflict?'Periksa sumber':formatIDR(Number(row.paid_total||0))} /></div>
        <details className="report-mobile-details"><summary>Lihat detail pembayaran</summary><div className="report-mobile-detail-grid"><MobileValue label="Rekonsiliasi" value={row.reconciliation_status||'Belum rekonsiliasi'} /><MobileValue label="Selisih" value={formatIDR(Number(row.difference||0))} />{conflict?<><MobileValue label="Bukti manual" value={formatIDR(Number(row.manual_proof_total||0))} /><MobileValue label="Payment gateway" value={formatIDR(Number(row.gateway_total||0))} /></>:null}</div></details>
      </article>;
    })}</div>
  </div>;
}

function GenericTable({rows,type}:{rows:ReportRow[];type:Exclude<ReportType,'payments'>}) {
  const columns=REPORT_COLUMNS[type].filter((key)=>rows.some((row)=>key in row));
  const mobileKeys=MOBILE_FIELDS[type].filter((key)=>columns.includes(key));
  const detailKeys=columns.filter((key)=>!mobileKeys.includes(key));
  return <div className="card report-table-wrap">
    <table className={`report-table report-desktop-table report-generic-table report-type-${type}`}><thead><tr>{columns.map((key,index)=><th key={key} className={`${index===0?'report-sticky-col ':''}${isMoneyColumn(key)||key==='employee_count'?'report-num':''}`}>{reportColumnLabel(key)}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={`${String(row.submission_id||row.id||'row')}-${String(row.employee_id||index)}-${index}`}>{columns.map((key,columnIndex)=>{
      const value=row[key];
      const className=`${columnIndex===0?'report-sticky-col ':''}${isMoneyColumn(key)||key==='employee_count'?'report-num':''}`;
      if(key==='status'||key==='state'||key==='payment_status'||key==='reconciliation_status') return <td className={className} key={key}><span className={`report-status report-status-${reportStatusTone(value)}`}>{reportStatusLabel(value)}</span></td>;
      return <td className={className} key={key}>{formatReportValue(key,value)}</td>;
    })}</tr>)}</tbody></table>
    <div className="report-mobile-list">{rows.map((row,index)=><article className="report-mobile-card" key={`mobile-${String(row.submission_id||row.id||index)}-${index}`}><div className="report-mobile-head"><div><strong>{reportPrimaryTitle(row)}</strong><small>{reportSecondaryTitle(row)}</small></div>{(row.status||row.state||row.payment_status)?<span className={`report-status report-status-${reportStatusTone(row.status||row.state||row.payment_status)}`}>{reportStatusLabel(row.status||row.state||row.payment_status)}</span>:null}</div><div className="report-mobile-grid">{mobileKeys.map((key)=><MobileValue key={key} label={reportColumnLabel(key)} value={formatReportValue(key,row[key])} />)}</div>{detailKeys.length?<details className="report-mobile-details"><summary>Lihat detail laporan</summary><div className="report-mobile-detail-grid">{detailKeys.map((key)=><MobileValue key={key} label={reportColumnLabel(key)} value={formatReportValue(key,row[key])} />)}</div></details>:null}</article>)}</div>
  </div>;
}

function formatReportValue(key:string,value:unknown){
  if((key==='status'||key==='state'||key==='payment_status'||key==='reconciliation_status')&&value) return reportStatusLabel(value);
  if(typeof value==='number'&&isMoneyColumn(key)) return formatIDR(value);
  if(typeof value==='object'&&value!==null) return JSON.stringify(value);
  return String(value??'-');
}

function MobileValue({label,value}:{label:string;value:unknown}) {
  return <div><span>{label}</span><strong>{String(value??'-')}</strong></div>;
}

function Summary({label,value}:{label:string;value:string}) { return <div className="card report-summary"><span>{label}</span><strong title={value}>{value}</strong></div>; }
