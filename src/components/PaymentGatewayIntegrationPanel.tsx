'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { gatewayRuntimeHealth } from '@/lib/integration-health';
import { IntegrationHealthPill } from '@/components/integrations/IntegrationPrimitives';
import {
  getHostedPaymentStatus,
  getPaymentGatewayStatus,
  type PaymentGatewayReadiness,
} from '@/lib/payment-gateway-api';

type Props = { canManage:boolean; canView?:boolean };
type RuntimeState = { seamless:PaymentGatewayReadiness | null; hosted:PaymentGatewayReadiness | null };

function statusLabel(readiness: PaymentGatewayReadiness | null) {
  if (!readiness) return 'UNKNOWN';
  return readiness.configured ? 'READY' : readiness.provider === 'UNCONFIGURED' ? 'NOT CONFIGURED' : 'NOT READY';
}

export default function PaymentGatewayIntegrationPanel({ canManage, canView = true }: Props) {
  const [runtime, setRuntime] = useState<RuntimeState>({ seamless:null, hosted:null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const [seamless, hosted] = await Promise.all([getPaymentGatewayStatus(), getHostedPaymentStatus()]);
      setRuntime({ seamless:seamless.gateway, hosted:hosted.hosted });
      setCheckedAt(new Date());
      setRetryCount(0);
    } catch (cause) {
      setRetryCount((value) => value + 1);
      setError(cause instanceof Error ? cause.message : 'Status payment gateway gagal dimuat');
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => { void load(); }, [load]);

  const provider = runtime.seamless?.provider || runtime.hosted?.provider || 'UNCONFIGURED';
  const health = gatewayRuntimeHealth({
    provider,
    seamlessConfigured:Boolean(runtime.seamless?.configured),
    seamlessReason:runtime.seamless?.reason,
    hostedReason:runtime.hosted?.reason,
    inspected:Boolean(runtime.seamless || runtime.hosted),
  });
  const origin = useMemo(() => typeof window === 'undefined' ? '' : window.location.origin, []);
  const webhookUrl = origin ? `${origin}/api/payment-gateway-webhook` : '/api/payment-gateway-webhook';
  const hostedReturnUrl = origin ? `${origin}/api/payment-gateway-hosted-return` : '/api/payment-gateway-hosted-return';
  const isE2Pay = provider === 'E2PAY';

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      setCopied('');
    }
  }

  if (!canView) {
    return <div className="card integration-gateway-panel">
      <strong>Payment Gateway</strong>
      <p>Status gateway hanya tersedia untuk tim payroll dan controller.</p>
    </div>;
  }

  return <section className="card integration-gateway-panel" aria-label="Payment Gateway integration" aria-busy={loading}>
    <div className="integrations-section-head">
      <div>
        <span className="workspace-eyebrow">PAYMENT ORCHESTRATION</span>
        <h3>Payment Gateway</h3>
        <p>Runtime readiness, environment aktif, credential health, dan recovery guidance sebelum payment execution.</p>
      </div>
      <div className="integrations-head-actions">
        <IntegrationHealthPill state={health.state} label={health.label} />
        <button type="button" className="btn" disabled={loading} onClick={() => void load()}>{loading ? 'Checking…' : error ? 'Retry readiness' : 'Check readiness'}</button>
      </div>
    </div>

    <div className="sr-only" aria-live="polite">{loading ? 'Memeriksa readiness payment gateway' : checkedAt ? 'Readiness payment gateway selesai diperiksa' : ''}</div>
    {error ? <div className="app-notice-bubble app-notice-error" role="alert">
      <strong>Gateway status gagal</strong>
      <span>{error}{retryCount > 1 ? ` · retry ${retryCount}x` : ''}</span>
      <button type="button" className="btn" disabled={loading} onClick={() => void load()}>Retry sekarang</button>
    </div> : null}

    <div className="integration-health-banner">
      <div><span>Provider</span><strong>{provider}</strong><small>{isE2Pay ? 'E2Pay B2B Disbursement' : 'Runtime adapter'}</small></div>
      <div><span>Runtime health</span><strong>{health.label}</strong><small>{health.reason}</small></div>
      <div><span>Environment</span><strong>{runtime.seamless?.environment || '—'}</strong><small>{isE2Pay ? 'UAT dan Production terisolasi' : 'Provider runtime'}</small></div>
      <div><span>Last readiness</span><strong>{checkedAt ? checkedAt.toLocaleTimeString('id-ID') : '—'}</strong><small>{checkedAt ? checkedAt.toLocaleDateString('id-ID') : 'Belum diperiksa'}</small></div>
    </div>

    <div className="integrations-two-col">
      <div className="integration-panel">
        <div className="integration-panel-head"><div><strong>{isE2Pay ? 'E2Pay execution adapter' : 'Seamless / API'}</strong><small>Backend orchestration</small></div><span>{statusLabel(runtime.seamless)}</span></div>
        <div className="integration-gateway-body">
          <span>Payment dieksekusi dari ProQPay hanya setelah Payment Instruction lolos maker-checker.</span>
          <small>{runtime.seamless?.reason || 'Adapter seamless siap digunakan.'}</small>
          {!runtime.seamless?.configured && provider !== 'UNCONFIGURED' ? <div className="integration-recovery-box"><strong>Recovery</strong><span>Periksa profile aktif di Settings → Payment Gateway, jalankan Test Connection, lalu Activate kembali bila credential atau source account berubah.</span></div> : null}
        </div>
      </div>
      <div className="integration-panel">
        <div className="integration-panel-head"><div><strong>{isE2Pay ? 'Environment authority' : 'Hosted checkout'}</strong><small>{isE2Pay ? 'Active runtime profile' : 'Browser handoff'}</small></div><span>{isE2Pay ? runtime.seamless?.environment || '—' : statusLabel(runtime.hosted)}</span></div>
        <div className="integration-gateway-body">
          {isE2Pay ? <>
            <span>Credential UAT dan Production disimpan sebagai profile terpisah dan terenkripsi.</span>
            <small>Perubahan draft tidak mengubah runtime sampai explicit activation berhasil.</small>
          </> : <>
            <span>User diarahkan ke checkout provider; browser return bukan bukti payment.</span>
            <small>{runtime.hosted?.reason || 'Hosted checkout siap digunakan.'}</small>
          </>}
        </div>
      </div>
    </div>

    {isE2Pay ? <div className="integration-recovery-box">
      <strong>Operational recovery path</strong>
      <span>1. Check readiness → 2. Settings → Payment Gateway → pilih environment → 3. Test Connection → 4. Activate → 5. kembali ke Integrations dan Check readiness. Untuk transaksi berstatus unknown/96, gunakan reconciliation dari Payment Control; jangan menjalankan ulang payment tanpa status check.</span>
    </div> : <div className="integration-callbacks">
      <strong>Provider callback endpoints</strong>
      <div><code>{webhookUrl}</code><button className="btn" type="button" onClick={() => void copy('webhook', webhookUrl)}>{copied === 'webhook' ? 'Copied' : 'Copy webhook'}</button></div>
      <div><code>{hostedReturnUrl}</code><button className="btn" type="button" onClick={() => void copy('return', hostedReturnUrl)}>{copied === 'return' ? 'Copied' : 'Copy return'}</button></div>
    </div>}

    <details className="integration-diagnostics">
      <summary aria-label="Buka runtime diagnostics Payment Gateway">Runtime diagnostics</summary>
      <div>
        <span><strong>Provider:</strong> {provider}</span>
        <span><strong>Seamless:</strong> {statusLabel(runtime.seamless)}</span>
        <span><strong>Environment:</strong> {runtime.seamless?.environment || '—'}</span>
        <span><strong>Hosted:</strong> {statusLabel(runtime.hosted)}</span>
        <span><strong>Readiness reason:</strong> {runtime.seamless?.reason || runtime.hosted?.reason || 'No issue reported'}</span>
        <span><strong>Operator:</strong> {canManage ? 'Dapat mengeksekusi payment setelah PI approved.' : 'Read-only integration visibility.'}</span>
      </div>
    </details>
  </section>;
}
