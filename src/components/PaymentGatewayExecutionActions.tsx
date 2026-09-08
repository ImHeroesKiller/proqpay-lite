'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createHostedPaymentSession,
  executeSeamlessPayment,
  getHostedPaymentStatus,
  getPaymentGatewayStatus,
  type HostedPaymentSession,
  type PaymentGatewayReadiness,
  type PaymentGatewayTransaction,
} from '@/lib/payment-gateway-api';

type Props = {
  paymentInstructionId: string;
  canExecuteGateway: boolean;
  onManualProof?: () => void;
  onChanged?: () => void | Promise<void>;
};

type Runtime = {
  seamless: PaymentGatewayReadiness | null;
  hosted: PaymentGatewayReadiness | null;
  transaction: PaymentGatewayTransaction | null;
  session: HostedPaymentSession | null;
};

const activeTransaction = (value: PaymentGatewayTransaction | null) => value && ['CREATED','PENDING','PROCESSING'].includes(value.status);
const activeHosted = (value: HostedPaymentSession | null) => value && ['CREATED','READY','OPENED','RETURNED'].includes(value.status);

export default function PaymentGatewayExecutionActions({ paymentInstructionId, canExecuteGateway, onManualProof, onChanged }: Props) {
  const [runtime, setRuntime] = useState<Runtime>({ seamless:null, hosted:null, transaction:null, session:null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [seamless, hosted] = await Promise.all([
        getPaymentGatewayStatus(paymentInstructionId),
        getHostedPaymentStatus(paymentInstructionId),
      ]);
      setRuntime({
        seamless: seamless.gateway,
        hosted: hosted.hosted,
        transaction: seamless.transaction || null,
        session: hosted.session || null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Status gateway gagal dimuat');
    } finally {
      setLoading(false);
    }
  }, [paymentInstructionId]);

  useEffect(() => { void load(); }, [load]);

  async function changed() {
    await load();
    await onChanged?.();
  }

  async function seamless() {
    setBusy('seamless'); setError('');
    try {
      await executeSeamlessPayment(paymentInstructionId, 'BANK_TRANSFER');
      await changed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Eksekusi seamless gagal');
    } finally {
      setBusy('');
    }
  }

  async function hosted() {
    setBusy('hosted'); setError('');
    try {
      const result = await createHostedPaymentSession(paymentInstructionId, '/?view=payments');
      if (!result.session.checkout_url) throw new Error('Hosted checkout URL tidak tersedia');
      window.location.assign(result.session.checkout_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hosted checkout gagal dibuka');
      setBusy('');
    }
  }

  const seamlessReady = Boolean(runtime.seamless?.configured);
  const hostedReady = Boolean(runtime.hosted?.configured);
  const transactionActive = Boolean(activeTransaction(runtime.transaction));
  const hostedActive = Boolean(activeHosted(runtime.session));
  const hostedCanContinue = hostedActive && Boolean(runtime.session?.checkout_url);

  return <div style={{ display:'grid', gap:6, minWidth:190 }}>
    <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
      {canExecuteGateway && seamlessReady && !transactionActive && !hostedActive ? <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void seamless()}>{busy === 'seamless' ? 'Memproses…' : 'Seamless'}</button> : null}
      {canExecuteGateway && hostedReady && !transactionActive && !hostedActive ? <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void hosted()}>{busy === 'hosted' ? 'Membuka…' : 'Hosted'}</button> : null}
      {canExecuteGateway && hostedCanContinue ? <button className="btn btn-primary" type="button" onClick={() => window.location.assign(String(runtime.session?.checkout_url))}>Lanjut Hosted</button> : null}
      {onManualProof ? <button className="btn" type="button" onClick={onManualProof}>Catat Bukti</button> : null}
      <button className="btn" type="button" disabled={loading} onClick={() => void load()} aria-label="Refresh status gateway">↻</button>
    </div>
    {transactionActive ? <small style={{ color:'var(--text3)' }}>Gateway {runtime.transaction?.provider} · {runtime.transaction?.status}</small> : null}
    {hostedActive ? <small style={{ color:'var(--text3)' }}>Hosted {runtime.session?.status} · berlaku sampai {runtime.session?.expires_at ? new Date(runtime.session.expires_at).toLocaleTimeString('id-ID') : '-'}</small> : null}
    {!loading && !seamlessReady && !hostedReady ? <small style={{ color:'var(--text3)' }}>Gateway belum ready. <a href="?view=integrations">Cek Integrations</a></small> : null}
    {!canExecuteGateway && (seamlessReady || hostedReady) ? <small style={{ color:'var(--text3)' }}>Eksekusi gateway dilakukan Payroll Processor setelah approval.</small> : null}
    {error ? <small style={{ color:'#b91c1c' }}>{error}</small> : null}
  </div>;
}
