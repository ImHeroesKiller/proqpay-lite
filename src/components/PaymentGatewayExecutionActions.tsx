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
  type PaymentGatewayTimelineEvent,
  type ArPaymentGate,
} from '@/lib/payment-gateway-api';

type Props = {
  paymentInstructionId: string;
  expectedPeriod: string;
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
  timeline: PaymentGatewayTimelineEvent[];
  arGate: ArPaymentGate | null;
};

const activeTransaction = (value: PaymentGatewayTransaction | null) => value && ['CREATED','PENDING','PROCESSING'].includes(value.status);
const activeHosted = (value: HostedPaymentSession | null) => Boolean(value
  && ['CREATED','READY','OPENED','RETURNED'].includes(value.status)
  && new Date(value.expires_at).getTime() > Date.now());

export default function PaymentGatewayExecutionActions({ paymentInstructionId, expectedPeriod, canExecuteGateway, onManualProof, onChanged }: Props) {
  const [runtime, setRuntime] = useState<Runtime>({ seamless:null, hosted:null, transaction:null, items:[], session:null, operational:null, timeline:[], arGate:null });
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
      const hosted = await getHostedPaymentStatus(paymentInstructionId, expectedPeriod);
      const seamless = await getPaymentGatewayStatus(paymentInstructionId, expectedPeriod);
      setRuntime({
        seamless: seamless.gateway,
        hosted: hosted.hosted,
        transaction: seamless.transaction || null,
        items: seamless.items || [],
        session: hosted.session || null,
        operational: seamless.operational || null,
        timeline: seamless.timeline || [],
        arGate: seamless.arGate || null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Status gateway gagal dimuat');
    } finally {
      setLoading(false);
    }
  }, [paymentInstructionId, expectedPeriod]);

  useEffect(() => { void load(); }, [load]);

  async function changed() {
    await load();
    await onChanged?.();
  }

  async function seamless() {
    if (!window.confirm('Konfirmasi final Payroll Controller: Payment Instruction yang sudah approved akan dieksekusi melalui payment gateway. Lanjutkan pembayaran?')) return;
    setBusy('seamless'); setError('');
    try {
      let result = await executeSeamlessPayment(paymentInstructionId, 'BANK_TRANSFER', expectedPeriod);
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
      await reconcileE2PayPayment(paymentInstructionId, expectedPeriod);
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
      const result=await verifyFailedE2PayPayment(paymentInstructionId, expectedPeriod);
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
      let result = await retryFailedE2PayPayment(paymentInstructionId, expectedPeriod);
      let continuationCalls = 0;
      let previousProgress = '';
      while (result.hasMore && continuationCalls < 100) {
        const progress = [result.parentStatus,result.remaining,result.summary?.ready,result.summary?.succeeded,result.summary?.failed].join(':');
        if (progress === previousProgress) {
          setError('Progress retry E2Pay tidak berubah. Refresh status dan lakukan reconciliation sebelum melanjutkan.');
          break;
        }
        previousProgress = progress;
        result = await retryFailedE2PayPayment(paymentInstructionId, expectedPeriod);
        continuationCalls += 1;
      }
      if (result.hasMore && continuationCalls >= 100) {
        setError(`Masih ada ${Number(result.remaining || 0).toLocaleString('id-ID')} beneficiary retry. Refresh status sebelum meneruskan.`);
      }
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
      const result = await createHostedPaymentSession(paymentInstructionId, `/?view=payments&period=${encodeURIComponent(expectedPeriod)}`, expectedPeriod);
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
  const e2payReady = runtime.items.filter((item) => ['CREATED','INQUIRY_READY','RETRY_INQUIRY_READY'].includes(item.status)).length;
  const e2paySucceeded = runtime.items.filter((item) => item.status === 'SUCCEEDED').length;
  const e2payFailed = runtime.items.filter((item) => item.status === 'FAILED').length;
  const e2payRetryable = Number(runtime.operational?.retryableFailedItems
    ?? runtime.items.filter((item) => item.status === 'RETRY_READY'
      || item.status === 'RETRY_INQUIRY_READY'
      || (item.status === 'FAILED' && String(item.response_code || '').trim() === '99')).length);
  const e2payBlockingFailed = Number(runtime.operational?.blockingFailedItems ?? Math.max(0, e2payFailed - e2payRetryable));
  const e2payNeedsVerification = runtime.items.filter((item) => item.status === 'FAILED'
    && String(item.error_code || '') === 'E2PAY_HTTP_ERROR'
    && /E2Pay HTTP\s+4\d\d/i.test(String(item.error_message || ''))
    && !/E2Pay HTTP\s+(408|409|429)/i.test(String(item.error_message || ''))).length;
  const safeRetryVerified = runtime.items.filter((item) => item.status === 'RETRY_READY').length;
  const firstFailure = runtime.items.find((item) => item.status === 'FAILED'
    && (item.error_message || item.response_message));
  const diagnosticItem = runtime.items.find((item) => item.request_diagnostics)
    || runtime.items.find((item) => item.provider_http_status || item.failure_stage)
    || firstFailure;
  const diagnostics = diagnosticItem?.request_diagnostics || null;
  const operational = runtime.operational;
  const gatewayState = operational?.state || runtime.transaction?.provider_status || runtime.transaction?.status || 'IDLE';
  const staleReconcile = Boolean(isE2Pay && operational?.stale && operational.needsReconciliation);
  const arBlocked = Boolean(runtime.arGate?.blocked && !transactionActive && !hostedActive);

  return <div style={{ display:'grid', gap:6, minWidth:190 }}>
    <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
      {canExecuteGateway && !arBlocked && seamlessReady && ((!transactionActive && (!isE2Pay || e2payFailed === 0)) || (isE2Pay && e2payReady > 0 && e2payFailed === 0)) && !hostedActive ? <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void seamless()}>{busy === 'seamless' ? 'Memproses…' : isE2Pay ? (transactionActive ? 'Lanjut E2Pay' : 'Bayar via E2Pay') : 'Seamless'}</button> : null}
      {canExecuteGateway && isE2Pay && transactionActive && e2payUnresolved > 0 ? <button className={staleReconcile ? 'btn btn-primary' : 'btn'} type="button" disabled={Boolean(busy)} onClick={() => void reconcileE2Pay()}>{busy === 'reconcile' ? 'Sinkron…' : staleReconcile ? 'Sync status sekarang' : 'Sync E2Pay'}</button> : null}
      {canExecuteGateway && isE2Pay && e2payNeedsVerification > 0 && e2payRetryable === 0 && e2payUnresolved === 0 ? <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void verifyFailedE2Pay()}>{busy === 'verify-failed' ? 'Verifikasi…' : 'Verifikasi E2Pay'}</button> : null}
      {canExecuteGateway && isE2Pay && Boolean(operational?.safeToRetry) && e2payRetryable > 0 && e2payUnresolved === 0 ? <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void retryFailedE2Pay()}>{busy === 'retry-failed' ? 'Retry…' : runtime.items.some((item)=>item.status==='RETRY_INQUIRY_READY') ? `Lanjut Retry (${e2payRetryable})` : `Retry Aman (${e2payRetryable})`}</button> : null}
      {canExecuteGateway && !arBlocked && hostedReady && !transactionActive && !hostedActive ? <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void hosted()}>{busy === 'hosted' ? 'Membuka…' : 'Hosted'}</button> : null}
      {canExecuteGateway && hostedCanContinue ? <button className="btn btn-primary" type="button" onClick={() => window.location.assign(String(runtime.session?.checkout_url))}>Lanjut Hosted</button> : null}
      {onManualProof ? <button className="btn" type="button" onClick={onManualProof}>Catat Bukti</button> : null}
      <button className="btn" type="button" disabled={loading} onClick={() => void load()} aria-label="Refresh status gateway">↻</button>
    </div>
    {isE2Pay?<div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
      <span className="integration-health-pill">{`Gateway · ${String(gatewayState).replaceAll('_',' ')}`}</span>
      {runtime.transaction?.provider_status && runtime.transaction.provider_status!==runtime.transaction.status
        ? <span className="integration-health-pill">{`Provider · ${String(runtime.transaction.provider_status).replaceAll('_',' ')}`}</span>
        : null}
      {diagnosticItem?.attempt_count
        ? <span className="integration-health-pill">{`Attempt · ${diagnosticItem.attempt_count}`}</span>
        : null}
    </div>:null}
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
        : `Ada ${e2payBlockingFailed || e2payFailed} beneficiary gagal yang tidak aman diulang otomatis. Review provider/reference sebelum tindakan manual.`}</small> : null}
    {isE2Pay && firstFailure ? <small style={{ color:'#b91c1c' }}><strong>Error provider:</strong> {String(firstFailure.error_message || firstFailure.response_message || 'Unknown error')}</small> : null}
    {isE2Pay && runtime.timeline.length ? <details className="integration-diagnostics">
      <summary>Riwayat eksekusi · {runtime.timeline.length} event</summary>
      <div style={{ display:'grid', gap:7, paddingTop:8, maxHeight:260, overflow:'auto' }}>
        {runtime.timeline.slice(0,30).map((event) => <div key={event.id} style={{ display:'grid', gap:2, padding:'7px 0', borderBottom:'1px solid var(--border-soft)' }}>
          <span style={{ fontSize:11, fontWeight:700 }}>{event.label}</span>
          <span style={{ fontSize:10.5, color:'var(--text3)' }}>{new Date(event.at).toLocaleString('id-ID', { timeZone:'Asia/Jakarta' })} WIB · {String(event.status || '').replaceAll('_',' ')}</span>
          {event.detail ? <span style={{ fontSize:10.5, color:'var(--text3)', overflowWrap:'anywhere' }}>{event.detail}</span> : null}
        </div>)}
        {runtime.timeline.length > 30 ? <small style={{ color:'var(--text3)' }}>Menampilkan 30 event terbaru dari {runtime.timeline.length} event.</small> : null}
      </div>
    </details> : null}
    {isE2Pay && diagnosticItem && (diagnostics || diagnosticItem.provider_http_status || diagnosticItem.failure_stage) ? <details className="integration-diagnostics">
      <summary>Diagnostik request E2Pay</summary>
      <div style={{ display:'grid', gap:4, paddingTop:6, fontSize:11, color:'var(--text3)' }}>
        <span>Stage: <strong>{diagnosticItem.failure_stage||'—'}</strong> · HTTP: <strong>{diagnosticItem.provider_http_status||'—'}</strong></span>
        {diagnostics?.accountSrc?<span>accountSrc: ••••{diagnostics.accountSrc.last4||'—'} · len {diagnostics.accountSrc.length} · merchant match {diagnostics.accountSrc.matchesMerchantAccount===true?'YES':diagnostics.accountSrc.matchesMerchantAccount===false?'NO':'UNKNOWN'} · fp {diagnostics.accountSrc.fingerprint||'—'}</span>:null}
        {diagnostics?.sourceId?<span>sourceId: configured · len {diagnostics.sourceId.length} · fp {diagnostics.sourceId.fingerprint||'—'} · validation {diagnostics.sourceId.verification||'CONFIG ONLY'}</span>:null}
        {diagnostics?.clientRef?<span>clientRef: {diagnostics.clientRef.value||'—'} · len {diagnostics.clientRef.length} · ASCII {diagnostics.clientRef.ascii?'YES':'NO'}</span>:null}
        {diagnostics?.description?<span>description: len {diagnostics.description.length} · fp {diagnostics.description.fingerprint||'—'}</span>:null}
        {diagnostics?.inquiryId?<span>inquiryId: len {diagnostics.inquiryId.length} · fp {diagnostics.inquiryId.fingerprint||'—'}</span>:null}
        {diagnostics?.password?<span>password contract: present {diagnostics.password.present?'YES':'NO'} · MD5 uppercase {diagnostics.password.md5Uppercase?'YES':'NO'}</span>:null}
        <small>Diagnostik ini tidak menyimpan password, token, full accountSrc, atau raw sourceId.</small>
      </div>
    </details> : null}
    {hostedActive ? <small style={{ color:'var(--text3)' }}>Hosted {runtime.session?.status} · berlaku sampai {runtime.session?.expires_at ? new Date(runtime.session.expires_at).toLocaleTimeString('id-ID') : '-'}</small> : null}
    {!loading && runtime.session?.status === 'EXPIRED' ? <small style={{ color:'var(--text3)' }}>Hosted session sebelumnya sudah expired. Payment dapat dicoba kembali.</small> : null}
    {!loading && !seamlessReady && !hostedReady ? <small style={{ color:'var(--text3)' }}>Gateway belum ready. <a href="?view=integrations">Cek Integrations</a></small> : null}
    {!canExecuteGateway && (seamlessReady || hostedReady) ? <small style={{ color:'var(--text3)' }}>Eksekusi pembayaran hanya dapat dilakukan oleh Payroll Controller setelah approval final.</small> : null}
    {notice ? <small style={{ color:'#047857' }} role="status">{notice}</small> : null}
    {error ? <small style={{ color:'#b91c1c' }} role="alert">{error}</small> : null}
  </div>;
}
