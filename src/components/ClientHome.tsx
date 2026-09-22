'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { invalidateOperatingCache, listOperatingDashboard } from '@/lib/operating-model-api';
import { derivePayrollBusinessStage } from '@/lib/payroll-business-stage';
import { derivePayrollNextAction } from '@/lib/payroll-next-action';
import { formatIDR } from '@/lib/format';
import type { AppView } from './Sidebar';
import type { DashboardActor, DashboardApiResponse, DashboardInvoice, DashboardPaymentInstruction, DashboardSubmission } from '@/lib/dashboard-types';

type Actor = Omit<DashboardActor,'permissions'> & { permissions?:string[] };

type Props = {
  actor:Actor;
  period:string;
  onNavigate:(view:AppView)=>void;
};

function actionLabel(code:string,label:string) {
  if (code === 'CORRECT_PAYROLL_DATA') return 'Perbaiki data payroll';
  if (code === 'REVIEW_PAYROLL_REVISION') return 'Tinjau revisi payroll';
  if (code === 'APPROVE_PAYROLL') return 'Review & approve';
  if (code === 'VIEW_RESULTS') return 'Lihat dokumen';
  if (code === 'TRACK_PAYROLL') return 'Lihat status payroll';
  return label;
}

function paymentLabel(status:string) {
  const labels:Record<string,string> = {
    PAYMENT_INSTRUCTION_READY:'Disiapkan',
    PAYMENT_APPROVAL_PENDING:'Menunggu approval',
    APPROVED_FOR_PAYMENT:'Siap dibayar',
    DISBURSEMENT_PROCESSING:'Sedang diproses',
    PAYMENT_CONFIRMED:'Pembayaran terkonfirmasi',
    PROOF_UPLOADED:'Verifikasi pembayaran',
    RECONCILIATION:'Rekonsiliasi',
    PAYMENT_EXCEPTION:'Perlu perhatian',
    REVISION_REQUIRED:'Perlu revisi',
    COMPLETED:'Selesai',
  };
  return labels[String(status||'')] || String(status||'-').replaceAll('_',' ');
}

type ClientDashboardRow = DashboardSubmission & {
  instruction?:DashboardPaymentInstruction;
  business:ReturnType<typeof derivePayrollBusinessStage>;
  nextAction:ReturnType<typeof derivePayrollNextAction>;
};

export default function ClientHome({actor,period,onNavigate}:Props) {
  const [data,setData] = useState<DashboardApiResponse>({submissions:[],paymentInstructions:[]});
  const [invoices,setInvoices] = useState<DashboardInvoice[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');

  const load = useCallback(async()=>{
    setLoading(true); setError('');
    setData({submissions:[],paymentInstructions:[]}); setInvoices([]);
    try {
      const [dashboard,billingResponse] = await Promise.all([
        listOperatingDashboard(undefined,period),
        fetch('/api/billing',{credentials:'same-origin',cache:'no-store'}),
      ]);
      setData(dashboard);
      const billing = await billingResponse.json().catch(()=>({})) as { error?:string; invoices?:DashboardInvoice[] };
      if (!billingResponse.ok) throw new Error(billing.error || `HTTP ${billingResponse.status}`);
      setInvoices(Array.isArray(billing.invoices) ? billing.invoices : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dashboard client gagal dimuat');
    } finally {
      setLoading(false);
    }
  },[period]);

  useEffect(()=>{void load();},[load]);

  const submissions = useMemo(()=>data.submissions||[],[data.submissions]);
  const instructions = useMemo(()=>data.paymentInstructions||[],[data.paymentInstructions]);
  const instructionBySubmission = useMemo(()=>{
    const map=new Map<string,DashboardPaymentInstruction>();
    instructions.forEach((row)=>{if(!map.has(String(row.submission_id))) map.set(String(row.submission_id),row);});
    return map;
  },[instructions]);
  const rows = useMemo<ClientDashboardRow[]>(()=>submissions.map((row)=>{
    const instruction = instructionBySubmission.get(row.id);
    const context = {
      role:'CLIENT_USER',
      permissions:actor.permissions||[],
      state:row.state,
      inputStatus:row.input_status,
      sourceMode:row.source_mode,
      blockingCount:row.blocking_count,
      exceptionCount:row.exception_count,
      paymentInstructionStatus:instruction?.status,
      reconciliationStatus:row.reconciliation_status,
      invoiceStatus:row.invoice_status,
      arStatus:row.ar_status,
      periodStatus:row.period_status,
      hasPaymentInstruction:Boolean(instruction),
      paymentInstructionId:instruction?.id,
    };
    return {
      ...row,
      instruction,
      business:derivePayrollBusinessStage(context),
      nextAction:derivePayrollNextAction(context),
    };
  }),[submissions,instructionBySubmission,actor.permissions]);

  const needsAttention = rows.filter((row)=>row.nextAction.actionable && row.nextAction.category!=='APPROVAL');
  const forApproval = rows.filter((row)=>row.nextAction.actionable && row.nextAction.category==='APPROVAL');
  const processingPayments = instructions.filter((row)=>!['COMPLETED','REJECTED','REVISION_REQUIRED'].includes(row.status));
  const completedPayments = instructions.filter((row)=>row.status==='COMPLETED');
  const visibleInvoices = invoices.filter((row)=>period==='ALL'||row.period===period);
  const latest = [...rows].sort((a,b)=>{
    const byPeriod=String(b.period||'').localeCompare(String(a.period||''));
    if(byPeriod) return byPeriod;
    const byUpdated=String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||''));
    if(byUpdated) return byUpdated;
    const rank=(value:string)=>value==='ADJUSTMENT'?3:value==='OFF_CYCLE'?2:1;
    return rank(String(b.run_type||'REGULAR'))-rank(String(a.run_type||'REGULAR'));
  }).slice(0,8);

  if (loading) return <div className="card control-loading" role="status" aria-live="polite">Menyiapkan Client Home…</div>;

  return <section style={{display:'grid',gap:16}} aria-busy={loading}>
    <div className="control-tower-heading">
      <div><span>CLIENT HOME</span><h1>Payroll Workspace</h1><p>Pantau payroll, tindak lanjuti data yang perlu diperbaiki, dan akses dokumen dalam satu tempat.</p></div>
      <button type="button" className="btn" onClick={()=>{invalidateOperatingCache();void load();}}>Refresh</button>
    </div>

    {error ? <div className="app-notice-bubble app-notice-error" role="alert"><strong>Data belum dapat dimuat</strong><span>{error}</span></div> : null}

    <div className="control-kpis" aria-label="Ringkasan payroll klien">
      <button type="button" className="control-kpi red" onClick={()=>onNavigate('operations')}><span className="control-kpi-label">Needs Your Attention</span><strong>{needsAttention.length}</strong><small>Payroll yang perlu tindakan Anda</small><i>→</i></button>
      <button type="button" className="control-kpi amber" onClick={()=>onNavigate('operations')}><span className="control-kpi-label">For Approval</span><strong>{forApproval.length}</strong><small>Payroll yang siap direview</small><i>→</i></button>
      <button type="button" className="control-kpi blue" onClick={()=>onNavigate('operations')}><span className="control-kpi-label">Payment Status</span><strong>{processingPayments.length}</strong><small>{completedPayments.length} pembayaran selesai</small><i>→</i></button>
      <button type="button" className="control-kpi green" onClick={()=>onNavigate('reports')}><span className="control-kpi-label">Invoices</span><strong>{visibleInvoices.length}</strong><small>Invoice pada periode aktif</small><i>→</i></button>
    </div>

    <section className="card action-center">
      <div className="control-panel-title"><div><span>PRIORITY</span><h2>Needs Your Attention</h2></div><small>{needsAttention.length} tindakan</small></div>
      <div className="action-list">
        {needsAttention.length ? needsAttention.slice(0,6).map((row)=><button type="button" key={row.id} onClick={()=>onNavigate('operations')}>
          <i className={`action-tone ${row.nextAction.tone}`} />
          <span><strong>{row.client_name||row.client_id}</strong><small>Payroll {row.period} · {row.project_name||'-'} · {row.business.label}</small></span>
          <b>{formatIDR(Number(row.total_net||0))}</b>
          <em>{actionLabel(row.nextAction.code,row.nextAction.label)} →</em>
        </button>) : <div className="control-empty">Tidak ada tindakan yang membutuhkan Anda.</div>}
      </div>
    </section>

    <section className="card portfolio-panel">
      <div className="control-panel-title"><div><span>PAYROLL STATUS</span><h2>Payroll Terbaru</h2></div><small>{rows.length} payroll</small></div>
      <div className="portfolio-table-wrap"><table className="portfolio-table dashboard-responsive-table">
        <caption className="visually-hidden">Payroll terbaru untuk scope akun klien dan periode aktif</caption>
        <thead><tr><th scope="col">Payroll</th><th scope="col">Stage</th><th scope="col">THP</th><th scope="col">Payment</th><th scope="col">Next</th></tr></thead><tbody>
        {latest.map((row)=><tr key={row.id}>
          <td data-label="Payroll"><strong>{row.client_name||row.client_id}</strong><small>{row.project_name||'-'} · {row.period}</small></td>
          <td data-label="Stage"><span className="stage-pill">{row.business.label}</span></td>
          <td data-label="THP"><strong>{formatIDR(Number(row.total_net||0))}</strong><small>{Number(row.employee_count||0)} karyawan</small></td>
          <td data-label="Payment">{row.instruction ? paymentLabel(row.instruction.status) : 'Belum masuk tahap pembayaran'}</td>
          <td data-label="Next"><button type="button" onClick={()=>onNavigate(row.nextAction.view==='billing'?'reports':'operations')}>{actionLabel(row.nextAction.code,row.nextAction.label)} →</button></td>
        </tr>)}
      </tbody></table>{!latest.length?<div className="control-empty" role="status">Belum ada payroll untuk scope akun ini.</div>:null}</div>
    </section>
  </section>;
}
