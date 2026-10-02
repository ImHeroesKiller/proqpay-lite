'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listAllPaginatedOperatingResource } from '@/lib/operating-model-api';
import { formatIDR } from '@/lib/format';
import PaymentGatewayExecutionActions from '@/components/PaymentGatewayExecutionActions';

type Props = {
  role: string;
  period?: string;
};

export default function PaymentGatewayPaymentPanel({ role, period = 'ALL' }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canExecuteGateway = role === 'PAYROLL_CONTROLLER';
  const canView = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(role);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const result = await listAllPaginatedOperatingResource('payment-instructions');
      setRows(Array.isArray(result.paymentInstructions) ? result.paymentInstructions : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gateway execution queue gagal dimuat');
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => { void load(); }, [load]);

  const active = useMemo(() => rows
    .filter((row) => ['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING'].includes(String(row.status || '')))
    .filter((row) => period === 'ALL'
      || String(row.payroll_period || row.payment_period || '') === period)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))), [rows, period]);

  if (!canView) return null;

  return <section className="card" style={{ marginTop:16, padding:18, display:'grid', gap:14 }} aria-label="Payment gateway execution queue">
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', alignItems:'flex-start' }}>
      <div>
        <span style={{ color:'var(--text3)', fontSize:10.5, fontWeight:700, letterSpacing:'.08em' }}>GATEWAY EXECUTION</span>
        <h3 style={{ margin:'4px 0 0', fontSize:17 }}>Payment Gateway Queue{period !== 'ALL' ? ` · ${period}` : ''}</h3>
        <p style={{ color:'var(--text3)', fontSize:12, margin:'5px 0 0' }}>PI yang sudah approved dan siap dieksekusi, dipantau, atau direcovery oleh Payroll Controller. Approval PI tetap valid meski attempt gateway gagal.</p>
      </div>
      <button className="btn" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh queue'}</button>
    </div>

    {error ? <div className="app-notice-bubble app-notice-error" role="alert"><strong>Queue gagal dimuat</strong><span>{error}</span></div> : null}

    {!loading && !active.length ? <div style={{ border:'1px dashed var(--border)', borderRadius:12, padding:18, color:'var(--text3)', fontSize:12 }}>Belum ada PI approved yang menunggu eksekusi gateway.</div> : null}

    {active.length ? <div style={{ display:'grid', gap:10 }}>
      {active.map((row) => <div key={row.id} style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) auto', gap:14, alignItems:'center', border:'1px solid var(--border-soft)', borderRadius:12, padding:14, background:'var(--bg-subtle)' }}>
        <div style={{ minWidth:0 }}>
          <strong style={{ display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.document_no || row.id}</strong>
          <span style={{ display:'block', color:'var(--text3)', fontSize:11, marginTop:3 }}>{row.client_name || row.client_id || '-'} · {formatIDR(Number(row.expected_total || 0))}</span>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginTop:6 }}>
            <span className="integration-health-pill">{`Approval · ${String(row.status || '').replaceAll('_',' ')}`}</span>
            <span style={{ color:'var(--text3)', fontSize:10.5 }}>{Number(row.recipient_count || 0).toLocaleString('id-ID')} penerima</span>
          </div>
        </div>
        <PaymentGatewayExecutionActions
          paymentInstructionId={row.id}
          expectedPeriod={String(row.payroll_period || row.payment_period || period || '')}
          canExecuteGateway={canExecuteGateway}
          onChanged={load}
        />
      </div>)}
    </div> : null}

    <small style={{ color:'var(--text3)' }}>Status APPROVED FOR PAYMENT adalah status approval PI, bukan bukti bahwa gateway sukses. Status E2Pay di sisi kanan adalah authority eksekusi yang aktual.</small>
  </section>;
}
