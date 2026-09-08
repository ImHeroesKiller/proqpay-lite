'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getHostedPaymentStatus,
  getPaymentGatewayStatus,
  type PaymentGatewayReadiness,
} from '@/lib/payment-gateway-api';

type Props = {
  canManage: boolean;
  canView?: boolean;
};

type RuntimeState = {
  seamless: PaymentGatewayReadiness | null;
  hosted: PaymentGatewayReadiness | null;
};

function statusLabel(readiness: PaymentGatewayReadiness | null) {
  if (!readiness) return 'UNKNOWN';
  return readiness.configured ? 'READY' : readiness.provider === 'UNCONFIGURED' ? 'NOT CONFIGURED' : 'NOT READY';
}

function tone(readiness: PaymentGatewayReadiness | null) {
  return readiness?.configured ? '#059669' : '#b45309';
}

export default function PaymentGatewayIntegrationPanel({ canManage, canView = true }: Props) {
  const [runtime, setRuntime] = useState<RuntimeState>({ seamless: null, hosted: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const [seamless, hosted] = await Promise.all([
        getPaymentGatewayStatus(),
        getHostedPaymentStatus(),
      ]);
      setRuntime({ seamless: seamless.gateway, hosted: hosted.hosted });
      setCheckedAt(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Status payment gateway gagal dimuat');
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => { void load(); }, [load]);

  const provider = runtime.seamless?.provider || runtime.hosted?.provider || 'UNCONFIGURED';
  const origin = useMemo(() => typeof window === 'undefined' ? '' : window.location.origin, []);
  const webhookUrl = origin ? `${origin}/api/payment-gateway-webhook` : '/api/payment-gateway-webhook';
  const hostedReturnUrl = origin ? `${origin}/api/payment-gateway-hosted-return` : '/api/payment-gateway-hosted-return';

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
    return <div className="card" style={{ padding:18 }}>
      <strong>Payment Gateway</strong>
      <p style={{ color:'var(--text3)', fontSize:12, margin:'8px 0 0' }}>Status gateway hanya tersedia untuk tim payroll dan controller.</p>
    </div>;
  }

  const cardStyle = { padding:18, display:'grid', gap:12 } as const;
  const modeStyle = { border:'1px solid var(--border-soft)', borderRadius:12, padding:14, display:'grid', gap:8, background:'var(--bg-subtle)' } as const;
  const endpointStyle = { display:'grid', gridTemplateColumns:'minmax(0,1fr) auto', gap:8, alignItems:'center' } as const;

  return <section className="card" style={cardStyle} aria-label="Payment Gateway integration">
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', alignItems:'flex-start' }}>
      <div>
        <span style={{ color:'var(--text3)', fontSize:10.5, fontWeight:700, letterSpacing:'.08em' }}>PAYMENT ORCHESTRATION</span>
        <h3 style={{ margin:'4px 0 0', fontSize:18 }}>Payment Gateway</h3>
        <p style={{ color:'var(--text3)', fontSize:12, margin:'6px 0 0', maxWidth:620 }}>
          Eksekusi payment setelah Payment Instruction lolos maker-checker. Secret tetap tersimpan server-side dan tidak pernah ditampilkan di browser.
        </p>
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <span style={{ border:`1px solid ${tone(runtime.seamless)}44`, color:tone(runtime.seamless), borderRadius:999, padding:'5px 9px', fontSize:10.5, fontWeight:700 }}>
          {provider}
        </span>
        <button type="button" className="btn" disabled={loading} onClick={() => void load()}>{loading ? 'Checking…' : 'Test readiness'}</button>
      </div>
    </div>

    {error ? <div className="app-notice-bubble app-notice-error" role="alert"><strong>Gateway status gagal</strong><span>{error}</span></div> : null}

    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:12 }}>
      <div style={modeStyle}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}><strong>Seamless / API</strong><span style={{ color:tone(runtime.seamless), fontSize:10.5, fontWeight:750 }}>{statusLabel(runtime.seamless)}</span></div>
        <span style={{ color:'var(--text3)', fontSize:11.5 }}>Payment tetap dieksekusi dari UI ProQPay melalui backend orchestration.</span>
        <small style={{ color:'var(--text3)' }}>{runtime.seamless?.reason || 'Adapter seamless siap digunakan.'}</small>
      </div>
      <div style={modeStyle}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}><strong>Hosted Checkout</strong><span style={{ color:tone(runtime.hosted), fontSize:10.5, fontWeight:750 }}>{statusLabel(runtime.hosted)}</span></div>
        <span style={{ color:'var(--text3)', fontSize:11.5 }}>User diarahkan ke checkout provider; return browser bukan bukti payment.</span>
        <small style={{ color:'var(--text3)' }}>{runtime.hosted?.reason || 'Hosted checkout siap digunakan.'}</small>
      </div>
    </div>

    <div style={{ display:'grid', gap:9 }}>
      <strong style={{ fontSize:12 }}>Provider callback endpoints</strong>
      <div style={endpointStyle}><code style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11 }}>{webhookUrl}</code><button className="btn" type="button" onClick={() => void copy('webhook', webhookUrl)}>{copied === 'webhook' ? 'Copied' : 'Copy webhook'}</button></div>
      <div style={endpointStyle}><code style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11 }}>{hostedReturnUrl}</code><button className="btn" type="button" onClick={() => void copy('return', hostedReturnUrl)}>{copied === 'return' ? 'Copied' : 'Copy return'}</button></div>
    </div>

    <details style={{ borderTop:'1px solid var(--border-soft)', paddingTop:10 }}>
      <summary style={{ cursor:'pointer', fontSize:12, fontWeight:650 }}>Runtime configuration checklist</summary>
      <div style={{ display:'grid', gap:6, marginTop:10, color:'var(--text3)', fontSize:11.5 }}>
        <span><code>PAYMENT_GATEWAY_PROVIDER</code> — provider adapter aktif.</span>
        <span><code>PAYMENT_GATEWAY_WEBHOOK_SECRET</code> — secret signature callback, Cloudflare Secret only.</span>
        <span><code>PAYMENT_GATEWAY_HOSTED_ENABLED</code> — aktifkan Hosted setelah adapter provider lolos sandbox.</span>
        <span><code>PAYMENT_GATEWAY_HOSTED_TTL_SECONDS</code> — TTL Hosted session, default 900 detik.</span>
      </div>
    </details>

    <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', alignItems:'center' }}>
      <span style={{ color:'var(--text3)', fontSize:10.5 }}>Last check: {checkedAt ? checkedAt.toLocaleString('id-ID') : 'belum diperiksa'}</span>
      <span style={{ color:'var(--text3)', fontSize:10.5 }}>{canManage ? 'Anda dapat mengeksekusi payment setelah PI approved.' : 'Konfigurasi credential dikelola server-side.'}</span>
    </div>
  </section>;
}
