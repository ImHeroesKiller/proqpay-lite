'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import OperatingWorkspace from '@/components/OperatingWorkspace';
import PaymentGatewayPaymentPanel from '@/components/PaymentGatewayPaymentPanel';

type Stage = 'PAYROLL' | 'PAYMENT' | 'CLOSE';

type Props = {
  role:string;
  period:string;
  gatewayCanView:boolean;
  initialStage?:Stage;
};

const stageMeta:Record<Stage,{step:string;title:string;description:string}> = {
  PAYROLL: {
    step:'1–2',
    title:'Data & Payroll',
    description:'Upload data, validasi readiness, selesaikan issue, lalu siapkan payroll.',
  },
  PAYMENT: {
    step:'3',
    title:'Approval & Payment',
    description:'Submit PI, Controller review, liquidity check, dan Process Payment.',
  },
  CLOSE: {
    step:'4',
    title:'Reconcile & Close',
    description:'Rekonsiliasi hasil pembayaran, billing, AR, dan penutupan periode.',
  },
};

export default function UnifiedPayrollWorkspace({
  role,
  period,
  gatewayCanView,
  initialStage='PAYROLL',
}:Props) {
  const [stage,setStage]=useState<Stage>(initialStage);
  useEffect(()=>setStage(initialStage),[initialStage]);

  const canUpload=useMemo(()=>['SUPER_ADMIN','PAYROLL_PROCESSOR','CLIENT_USER'].includes(role),[role]);
  const isController=role==='PAYROLL_CONTROLLER';

  return (
    <section className="unified-payroll-workspace">
      <header className="unified-payroll-head">
        <div>
          <span className="page-eyebrow">END-TO-END PAYROLL</span>
          <h1>Payroll Workspace</h1>
          <p>Satu workspace untuk proses payroll dari data masuk sampai pembayaran selesai dan periode ditutup.</p>
        </div>
        {canUpload ? (
          <Link className="btn btn-primary" href={`/data-intake?period=${encodeURIComponent(period)}`}>
            Upload Payroll Data
          </Link>
        ) : null}
      </header>

      <nav className="payroll-stage-nav" aria-label="Tahap payroll">
        {(Object.keys(stageMeta) as Stage[]).map((key)=>{
          const meta=stageMeta[key];
          return (
            <button
              key={key}
              type="button"
              className={stage===key?'active':''}
              aria-current={stage===key?'step':undefined}
              onClick={()=>setStage(key)}
            >
              <b>{meta.step}</b>
              <span><strong>{meta.title}</strong><small>{meta.description}</small></span>
            </button>
          );
        })}
      </nav>

      {stage==='PAYROLL' ? (
        <div className="unified-payroll-stage">
          {canUpload ? (
            <div className="workflow-shortcut card">
              <div>
                <span>1 · DATA INPUT</span>
                <strong>Client atau Payroll Processor dapat upload data payroll</strong>
                <small>Setelah confirm, ProQPay langsung membentuk canonical payroll snapshot dan readiness check.</small>
              </div>
              <Link className="btn" href={`/data-intake?period=${encodeURIComponent(period)}`}>Upload / Review Data</Link>
            </div>
          ) : (
            <div className="workflow-shortcut card">
              <div>
                <span>1 · DATA INPUT</span>
                <strong>Data disiapkan oleh Client / Payroll Processor</strong>
                <small>Payroll Controller mulai dari review hasil payroll dan tidak menjadi uploader normal.</small>
              </div>
            </div>
          )}
          <OperatingWorkspace mode="payruns" />
        </div>
      ) : null}

      {stage==='PAYMENT' ? (
        <div className="unified-payroll-stage">
          <div className="workflow-shortcut card">
            <div>
              <span>3 · APPROVAL & PAYMENT</span>
              <strong>{isController?'Review, approve, lalu Process Payment':'Prepare dan submit ke Payroll Controller'}</strong>
              <small>Payment Instruction tetap immutable; final execution hanya Payroll Controller.</small>
            </div>
          </div>
          <OperatingWorkspace mode="payments" />
          {gatewayCanView ? <PaymentGatewayPaymentPanel role={role} /> : null}
        </div>
      ) : null}

      {stage==='CLOSE' ? (
        <div className="unified-payroll-stage">
          <div className="workflow-shortcut card">
            <div>
              <span>4 · RECONCILE & CLOSE</span>
              <strong>Selesaikan reconciliation, invoice, AR, dan close period</strong>
              <small>Detail teknis tetap tercatat di audit trail tanpa menambah langkah navigasi pengguna.</small>
            </div>
          </div>
          <OperatingWorkspace mode="billing" />
        </div>
      ) : null}
    </section>
  );
}
