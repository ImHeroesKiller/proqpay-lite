'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listOperatingDashboard } from '@/lib/operating-model-api';
import { derivePayrollBusinessStage } from '@/lib/payroll-business-stage';
import { derivePayrollNextAction } from '@/lib/payroll-next-action';
import { formatIDR } from '@/lib/format';
import type { AppView } from './Sidebar';

type Actor = {
  email:string;
  role:string;
  permissions?:string[];
  clientIds?:string[]|null;
};

type Props = {
  actor:Actor;
  onNavigate:(view:AppView)=>void;
};

function actionLabel(code:string,label:string) {
  if (code === 'CORRECT_PAYROLL_DATA') return 'Perbaiki data payroll';
  if (code === 'REVIEW_PAYROLL_REVISION') return 'Tinjau revisi payroll';
  if (code === 'APPROVE_PAYROLL') return 'Review payroll';
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

export default function ClientHome({actor,onNavigate}:Props) {
  const [data,setData] = useState<Record<string,any[]>>({});
  const [invoices,setInvoices] = useState<any[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');

  const load = useCallback(async()=>{
    setLoading(true); setError('');
    try {
      const clientIds = actor.clientIds || [];
      const [dashboards,billingResponse] = await Promise.all([
        Promise.all(clientIds.map((clientId)=>listOperatingDashboard(clientId))),
        fetch('/api/billing',{credentials:'same-origin',cache:'no-store'}),
      ]);
      const merged:Record<string,any[]> = {};
      dashboards.forEach((result:any)=>Object.entries(result).forEach(([key,value])=>{
        if (Array.isArray(value)) merged[key]=[...(merged[key]||[]),...value];
      }));
      setData(merged);
      const billing = await billingResponse.json().catch(()=>({}));
      if (!billingResponse.ok) throw new Error(billing.error || `HTTP ${billingResponse.status}`);
      setInvoices(billing.invoices || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dashboard client gagal dimuat');
    } finally {
      setLoading(false);
    }
  },[actor.clientIds]);

  useEffect(()=>{void load();},[load]);

  const submissions = useMemo(()=>data.submissions||[],[data.submissions]);
  const instructions = useMemo(()=>data.paymentInstructions||[],[data.paymentInstructions]);
  const instructionBySubmission = useMemo(()=>new Map(instructions.map((row:any)=>[row.submission_id,row])),[instructions]);
  const rows = useMemo(()=>submissions.map((row:any)=>{
    const instruction:any = instructionBySubmission.get(row.id);
    const context = {
      role:'CLIENT_USER',
      permissions:actor.permissions||[],
      state:row.state,
      inputStatus:row.input_status,
      sourceMode:row.source_mode,
      blockingCount:row.blocking_count,
      exceptionCount:row.exception_count,
      paymentInstructionStatus:instruction?.status,
      invoiceStatus:row.invoice_status,
      arStatus:row.ar_status,
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

  const needsAttention = rows.filter((row:any)=>row.nextAction.actionable && row.nextAction.category!=='APPROVAL');
  const forApproval = rows.filter((row:any)=>row.nextAction.actionable && row.nextAction.category==='APPROVAL');
  const processingPayments = instructions.filter((row:any)=>!['COMPLETED','REJECTED'].includes(row.status));
  const completedPayments = instructions.filter((row:any)=>row.status==='COMPLETED');
  const latest = [...rows].sort((a:any,b:any)=>String(b.period||'').localeCompare(String(a.period||''))).slice(0,8);

  if (loading) return <div className="card control-loading">Menyiapkan Client Home…</div>;

  return <section style={{display:'grid',gap:16}}>
    <div className="control-tower-heading">
      <div><span>CLIENT HOME</span><h1>Payroll Workspace</h1><p>Pantau payroll, tindak lanjuti data yang perlu diperbaiki, dan akses dokumen dalam satu tempat.</p></div>
      <button type="button" className="btn" onClick={()=>void load()}>Refresh</button>
    </div>

    {error ? <div className="app-notice-bubble app-notice-error"><strong>Data belum dapat dimuat</strong><span>{error}</span></div> : null}

    <div className="control-kpis">
      <button type="button" className="control-kpi red" onClick={()=>onNavigate('operations')}><span className="control-kpi-label">Needs Your Attention</span><strong>{needsAttention.length}</strong><small>Payroll yang perlu tindakan Anda</small><i>→</i></button>
      <button type="button" className="control-kpi amber" onClick={()=>onNavigate('operations')}><span className="control-kpi-label">For Approval</span><strong>{forApproval.length}</strong><small>Payroll yang siap direview</small><i>→</i></button>
      <button type="button" className="control-kpi blue" onClick={()=>onNavigate('operations')}><span className="control-kpi-label">Payment Status</span><strong>{processingPayments.length}</strong><small>{completedPayments.length} pembayaran selesai</small><i>→</i></button>
      <button type="button" className="control-kpi green" onClick={()=>onNavigate('reports')}><span className="control-kpi-label">Documents</span><strong>{invoices.length}</strong><small>Invoice dan laporan tersedia</small><i>→</i></button>
    </div>

    <section className="card action-center">
      <div className="control-panel-title"><div><span>PRIORITY</span><h2>Needs Your Attention</h2></div><small>{needsAttention.length} tindakan</small></div>
      <div className="action-list">
        {needsAttention.length ? needsAttention.slice(0,6).map((row:any)=><button type="button" key={row.id} onClick={()=>onNavigate('operations')}>
          <i className={`action-tone ${row.nextAction.tone}`} />
          <span><strong>{row.client_name||row.client_id}</strong><small>Payroll {row.period} · {row.project_name||'-'} · {row.business.label}</small></span>
          <b>{formatIDR(Number(row.total_net||0))}</b>
          <em>{actionLabel(row.nextAction.code,row.nextAction.label)} →</em>
        </button>) : <div className="control-empty">Tidak ada tindakan yang membutuhkan Anda.</div>}
      </div>
    </section>

    <section className="card portfolio-panel">
      <div className="control-panel-title"><div><span>PAYROLL STATUS</span><h2>Payroll Terbaru</h2></div><small>{rows.length} payroll</small></div>
      <div className="portfolio-table-wrap"><table className="portfolio-table"><thead><tr><th>Payroll</th><th>Stage</th><th>THP</th><th>Payment</th><th>Next</th></tr></thead><tbody>
        {latest.map((row:any)=><tr key={row.id}>
          <td><strong>{row.client_name||row.client_id}</strong><small>{row.project_name||'-'} · {row.period}</small></td>
          <td><span className="stage-pill">{row.business.label}</span></td>
          <td><strong>{formatIDR(Number(row.total_net||0))}</strong><small>{Number(row.employee_count||0)} karyawan</small></td>
          <td>{row.instruction ? paymentLabel(row.instruction.status) : 'Belum masuk tahap pembayaran'}</td>
          <td><button type="button" onClick={()=>onNavigate(row.nextAction.view==='billing'?'reports':'operations')}>{actionLabel(row.nextAction.code,row.nextAction.label)} →</button></td>
        </tr>)}
      </tbody></table>{!latest.length?<div className="control-empty">Belum ada payroll untuk scope akun ini.</div>:null}</div>
    </section>
  </section>;
}
