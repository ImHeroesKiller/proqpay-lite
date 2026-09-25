'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { gatewayRuntimeHealth } from '@/lib/integration-health';
import { IntegrationHealthPill } from '@/components/integrations/IntegrationPrimitives';
import E2PayOperationsConsole from '@/components/E2PayOperationsConsole';
import {
  getHostedPaymentStatus,
  getPaymentGatewayStatus,
  type PaymentGatewayReadiness,
} from '@/lib/payment-gateway-api';

type Props = { canManage:boolean; canView?:boolean };
type RuntimeState = { seamless:PaymentGatewayReadiness | null; hosted:PaymentGatewayReadiness | null };

export default function PaymentGatewayIntegrationPanel({ canManage, canView = true }: Props) {
  const [runtime, setRuntime] = useState<RuntimeState>({ seamless:null, hosted:null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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
    } catch (cause) {
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
  const isE2Pay = provider === 'E2PAY';
  const origin = useMemo(() => typeof window === 'undefined' ? '' : window.location.origin, []);
  const webhookUrl = origin ? `${origin}/api/payment-gateway-webhook` : '/api/payment-gateway-webhook';
  const hostedReturnUrl = origin ? `${origin}/api/payment-gateway-hosted-return` : '/api/payment-gateway-hosted-return';

  async function copy(label:string,value:string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(()=>setCopied(''),1600);
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

  return <section className="card integration-gateway-panel integration-gateway-panel-compact" aria-label="Payment Gateway integration" aria-busy={loading}>
    <div className="integrations-section-head">
      <div>
        <span className="workspace-eyebrow">PAYMENT GATEWAY</span>
        <h3>{isE2Pay ? 'E2Pay Disbursement' : 'Payment Gateway'}</h3>
        <p>Status runtime dan operasi provider yang relevan untuk proses payroll.</p>
      </div>
      <div className="integrations-head-actions">
        <IntegrationHealthPill state={health.state} label={health.label} />
        <button type="button" className="btn" disabled={loading} onClick={()=>void load()}>{loading?'Checking…':'Refresh status'}</button>
      </div>
    </div>

    {error?<div className="app-notice-bubble app-notice-error" role="alert"><strong>Gateway status gagal</strong><span>{error}</span></div>:null}

    <div className="integration-runtime-strip" aria-label="Ringkasan payment gateway">
      <div><span>Provider</span><strong>{provider}</strong></div>
      <div><span>Environment</span><strong>{runtime.seamless?.environment||'—'}</strong></div>
      <div><span>Execution</span><strong>{runtime.seamless?.configured?'READY':'NOT READY'}</strong></div>
      <div><span>Last check</span><strong>{checkedAt?checkedAt.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'—'}</strong></div>
    </div>

    {!runtime.seamless?.configured && provider!=='UNCONFIGURED'
      ? <div className="integration-recovery-box"><strong>Action required</strong><span>Periksa profile aktif di Settings → Payment Gateway, jalankan Test Connection, lalu Activate kembali.</span></div>
      : null}

    {isE2Pay ? <E2PayOperationsConsole canManage={canManage} /> : <>
      <div className="integration-callbacks">
        <strong>Provider callback endpoints</strong>
        <div><code>{webhookUrl}</code><button className="btn" type="button" onClick={()=>void copy('webhook',webhookUrl)}>{copied==='webhook'?'Copied':'Copy webhook'}</button></div>
        <div><code>{hostedReturnUrl}</code><button className="btn" type="button" onClick={()=>void copy('return',hostedReturnUrl)}>{copied==='return'?'Copied':'Copy return'}</button></div>
      </div>
    </>}
  </section>;
}
