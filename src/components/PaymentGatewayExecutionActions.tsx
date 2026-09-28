'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createHostedPaymentSession,
  executeSeamlessPayment,
  getHostedPaymentStatus,
  getPaymentGatewayStatus,
  reconcileE2PayPayment,
  verifyFailedE2PayPayment,
  retryFailedE2PayPayment,
  type HostedPaymentSession,
  type PaymentGatewayItem,
  type PaymentGatewayReadiness,
  type PaymentGatewayTransaction,
  type PaymentGatewayOperationalStatus,
  type ArPaymentGate,
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
  items: PaymentGatewayItem[];
  session: HostedPaymentSession | null;
  operational: PaymentGatewayOperationalStatus | null;
  arGate: ArPaymentGate | null;
};

const activeTransaction = (value: PaymentGatewayTransaction | null) => value && ['CREATED','PENDING','PROCESSING'].includes(value.status);
const activeHosted = (value: HostedPaymentSession | null) => Boolean(value
  && ['CREATED','READY','OPENED','RETURNED'].includes(value.status)
  && new Date(value.expires_at).getTime() > Date.now());

export default function PaymentGatewayExecutionActions({ paymentInstructionId, canExecuteGateway, onManualProof, onChanged }: Props) {
  const [runtime, setRuntime] = useState<Runtime>({ seamless:null, hosted:null, transaction:null, items:[], session:null, operational:null, arGate:null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Hosted status is loaded first because that endpoint also closes locally expired
      // Hosted sessions and their active transaction before the generic gateway status is read.
      const hosted = await getHostedPaymentStatus(paymentInstructionId);
      const seamless = await getPaymentGatewayStatus(paymentInstructionId);
      setRuntime({
        seamless: seamless.gateway,
        hosted: hosted.hosted,
        transaction: seamless.transaction || null,
        items: seamless.items || [],
        session: hosted.session || null,
        operational: seamless.operational || null,
        arGate: seamless.arGate || null,
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
    if (!window.confirm('Konfirmasi final Payroll Controller: Payment Instruction yang sudah approved akan dieksekusi melalui payment gateway. Lanjutkan pembayaran?')) return;
    setBusy('seamless'); setError('');
    try {
      let result = await executeSeamlessPayment(paymentInstructionId, 'BANK_TRANSFER');
      // E2Pay is deliberately processed in bounded Worker requests. Continue a
      // large PI automatically while every completed beneficiary stays durable
      // in the gateway ledger, so a browser/network interruption can resume safely.
      if (result.gateway?.provider === 'E2PAY') {
        let continuationCalls = 0;
        let previousProgress = '';
        while (result.hasMore && continuationCalls < 100) {
          const progress = [result.parentStatus,result.remaining,result.summary?.ready,result.summary?.succeeded,result.summary?.failed].join(':');
          if (progress === previousProgress) {
            setError('Progress E2Pay tidak berubah. Refresh status sebelum melanjutkan agar tidak melakukan loop request tanpa kemajuan.');
            break;
          }
          previousProgress = progress;
          result = await executeSeamlessPayment(paymentInstructionId, 'BANK_TRANSFER');
          continuationCalls += 1;
        }
        if (result.hasMore && continuationCalls >= 100) {
          setError(`Masih ada ${Number(result.remaining || 0).toLocaleString('id-ID')} beneficiary. Klik Lanjut E2Pay untuk meneruskan batch berikutnya.`);
        }
      }
      await changed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Eksekusi seamless gagal');
    } finally {
      setBusy('');
    }
  }

  async function reconcileE2Pay() {
    setBusy('reconcile'); setError('');
    try {
      await reconcileE2PayPayment(paymentInstructionId);
      await changed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sinkronisasi status E2Pay gagal');
    } finally {
      setBusy('');
    }
  }

  async function verifyFailedE2Pay() {
    if (!window.confirm('Verifikasi ke E2Pay Transaction History bahwa beneficiary gagal tidak pernah tercatat di provider. Tidak ada pembayaran yang dikirim pada langkah ini. Lanjutkan?')) return;
    setBusy('verify-failed'); setError(''); setNotice('');
    try {
      const result=await verifyFailedE2PayPayment(paymentInstructionId);
      await changed();
      if(result.verifiedSafe > 0){
        setNotice(`${result.verifiedSafe} beneficiary dipastikan tidak tercatat di E2Pay. Retry terkontrol sekarang tersedia untuk Payroll Controller.`);
      }else if(result.providerFound > 0){
        setNotice('Provider menemukan transaksi untuk sebagian item. Status sudah diselaraskan; review sebelum tindakan berikutnya.');
      }else{
        setError('Tidak ada item yang dapat dinyatakan aman untuk retry. Review error provider diperlukan.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Verifikasi failed item E2Pay gagal');
    } finally {
      setBusy('');
    }
  }

  async function retryFailedE2Pay() {
    if (!window.confirm(`Retry hanya akan dilakukan untuk ${e2payRetryable} beneficiary yang dinilai aman untuk diulang. Lanjutkan?`)) return;
    setBusy('retry-failed'); setError(''); setNotice('');
    try {
      await retryFailedE2PayPayment(paymentInstructionId);
      await changed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Retry beneficiary E2Pay gagal');
    } finally {
      setBusy('');
    }
  }

  async function hosted() {
    if (!window.confirm('Konfirmasi final Payroll Controller: lanjutkan ke Hosted Payment untuk Payment Instruction yang sudah approved?')) return;
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
  const isE2Pay = runtime.seamless?.provider === 'E2PAY';
  const e2payUnresolved = runtime.items.filter((item) => ['PENDING','PROCESSING','UNKNOWN'].includes(item.status)).length;
  const e2payReady = runtime.items.filter((item) => ['CREATED','INQUIRY_READY'].includes(item.status)).length;
  const e2paySucceeded = runtime.items.filter((item) => item.status === 'SUCCEEDED').length;
  const e2payFailed = runtime.items.filter((item) => item.status === 'FAILED').length;
  const e2payRetryable = runtime.items.filter((item) => item.status === 'FAILED' && (
    Number(item.attempt_count || 0) === 0
    || String(item.response_code || '').trim() === '99'
    || String(item.error_code || '').trim() === 'E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY'
  )).length;
  const e2payNeedsVerification = runtime.items.filter((item) => item.status === 'FAILED'
    && String(item.error_code || '') === 'E2PAY_HTTP_ERROR'
    && /E2Pay HTTP\s+4\d\d/i.test(String(item.error_message || ''))
    && !/E2Pay HTTP\s+(408|409|429)/i.test(String(item.error_message || ''))).length;
  const safeRetryVerified = runtime.items.filter((item) => item.status === 'FAILED'
    && String(item.error_code || '').trim() === 'E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY').length;
  const firstFailure = runtime.items.find((item) => item.status === 'FAILED'
    && String(item.error_code || '').trim() !== 'E2PAY_PROVIDER_NOT_FOUND_SAFE_RETRY'
    && (item.error_message || item.response_message));
  const operational = runtime.operational;
  const staleReconcile = Boolean(isE2Pay && operational?.stale && operational.needsReconciliation);
  const arBlocked = Boolean(runtime.arGate?.blocked && !transactionActive && !hostedActive);

  return <div style={{ display:'grid', gap:6, minWidth:190 }}>
    <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
      {canExecuteGateway && !arBlocked && seamlessReady && ((!transactionActive && (!isE2Pay || e2payFailed === 0)) || (isE2Pay && e2payReady > 0 && e2payFailed === 0)) && !hostedActive ? <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void seamless()}>{busy === 'seamless' ? 'Memproses…' : isE2Pay ? (transactionActive ? 'Lanjut E2Pay' : 'Bayar via E2Pay') : 'Seamless'}</button> : null}
      {canExecuteGateway && isE2Pay && transactionActive && e2payUnresolved > 0 ? <button className={staleReconcile ? 'btn btn-primary' : 'btn'} type="button" disabled={Boolean(busy)} onClick={() => void reconcileE2Pay()}>{busy === 'reconcile' ? 'Sinkron…' : staleReconcile ? 'Sync status sekarang' : 'Sync E2Pay'}</button> : null}
      {canExecuteGateway && isE2Pay && e2payNeedsVerification > 0 && e2payRetryable === 0 && e2payUnresolved === 0 ? <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void verifyFailedE2Pay()}>{busy === 'verify-failed' ? 'Verifikasi…' : 'Verifikasi E2Pay'}</button> : null}
      {canExecuteGateway && isE2Pay && e2payRetryable > 0 && e2payUnresolved === 0 ? <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void retryFailedE2Pay()}>{busy === 'retry-failed' ? 'Retry…' : `Retry Aman (${e2payRetryable})`}</button> : null}
      {canExecuteGateway && !arBlocked && hostedReady && !transactionActive && !hostedActive ? <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void hosted()}>{busy === 'hosted' ? 'Membuka…' : 'Hosted'}</button> : null}
      {canExecuteGateway && hostedCanContinue ? <button className="btn btn-primary" type="button" onClick={() => window.location.assign(String(runtime.session?.checkout_url))}>Lanjut Hosted</button> : null}
      {onManualProof ? <button className="btn" type="button" onClick={onManualProof}>Catat Bukti</button> : null}
      <button className="btn" type="button" disabled={loading} onClick={() => void load()} aria-label="Refresh status gateway">↻</button>
    </div>
    {arBlocked ? <div className="app-notice-bubble app-notice-error" role="alert" style={{ margin:0 }}>
      <strong>Payment blocked · Outstanding AR</strong>
      <span>{runtime.arGate?.mode === 'ANY_OUTSTANDING'
        ? `Outstanding klien ${Number(runtime.arGate?.outstanding||0).toLocaleString('id-ID')} masih belum dibayar.`
        : `Overdue AR ${Number(runtime.arGate?.overdue||0).toLocaleString('id-ID')} harus diselesaikan sebelum payment baru.`}</span>
    </div> : runtime.arGate?.warning ? <small style={{ color:'#b45309' }}>Warning AR: outstanding klien {Number(runtime.arGate.outstanding||0).toLocaleString('id-ID')}.</small> : null}
    {transactionActive ? <small style={{ color:'var(--text3)' }}>Gateway {runtime.transaction?.provider} · {runtime.transaction?.status}{operational?.activeLease ? ' · request aktif' : ''}</small> : null}
    {operational?.stale ? <small style={{ color:'#b45309' }}><strong>Status gateway stale {operational.staleMinutes} menit.</strong> {isE2Pay ? 'Sinkronkan status provider sebelum retry atau tindakan manual.' : 'Jangan retry sampai status provider dikonfirmasi.'}</small> : null}
    {operational?.state === 'RECONCILE' && !operational.stale ? <small style={{ color:'#b45309' }}>Status provider belum final. Selesaikan reconciliation sebelum retry.</small> : null}
    {runtime.transaction?.error_code === 'GATEWAY_EXECUTION_UNKNOWN' ? <small style={{ color:'#b91c1c' }}>Hasil eksekusi belum pasti. Retry diblokir sampai ada konfirmasi provider.</small> : null}
    {isE2Pay && runtime.items.length ? <small style={{ color:'var(--text3)' }}>E2Pay {e2paySucceeded}/{runtime.items.length} sukses · {e2payUnresolved} proses · {e2payReady} siap · {e2payFailed} gagal</small> : null}
    {isE2Pay && e2payFailed > 0 && e2payUnresolved === 0 && e2paySucceeded < runtime.items.length ? <small style={{ color:e2payRetryable > 0 ? '#047857' : '#b45309' }}>{e2payRetryable > 0
      ? `Verifikasi selesai. ${safeRetryVerified || e2payRetryable} beneficiary tidak tercatat di E2Pay; belum ada pembayaran provider dan retry terkontrol tersedia.`
      : e2payNeedsVerification > 0
        ? 'Request ditolak HTTP 4xx. Verifikasi Transaction History E2Pay dulu; jangan retry langsung.'
        : 'Ada beneficiary gagal yang tidak aman diulang otomatis. Review provider/reference sebelum tindakan manual.'}</small> : null}
    {isE2Pay && firstFailure ? <small style={{ color:'#b91c1c' }}><strong>Error provider:</strong> {String(firstFailure.error_message || firstFailure.response_message || 'Unknown error')}</small> : null}
    {hostedActive ? <small style={{ color:'var(--text3)' }}>Hosted {runtime.session?.status} · berlaku sampai {runtime.session?.expires_at ? new Date(runtime.session.expires_at).toLocaleTimeString('id-ID') : '-'}</small> : null}
    {!loading && runtime.session?.status === 'EXPIRED' ? <small style={{ color:'var(--text3)' }}>Hosted session sebelumnya sudah expired. Payment dapat dicoba kembali.</small> : null}
    {!loading && !seamlessReady && !hostedReady ? <small style={{ color:'var(--text3)' }}>Gateway belum ready. <a href="?view=integrations">Cek Integrations</a></small> : null}
    {!canExecuteGateway && (seamlessReady || hostedReady) ? <small style={{ color:'var(--text3)' }}>Eksekusi pembayaran hanya dapat dilakukan oleh Payroll Controller setelah approval final.</small> : null}
    {notice ? <small style={{ color:'#047857' }} role="status">{notice}</small> : null}
    {error ? <small style={{ color:'#b91c1c' }} role="alert">{error}</small> : null}
  </div>;
}
