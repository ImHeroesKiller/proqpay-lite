'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getIntegrationMonitor, type IntegrationMonitorResponse } from '@/lib/integration-monitor-api';

function fmtDate(value?: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('id-ID');
}

function statusTone(code?: number | null) {
  if (!code) return 'var(--text3)';
  if (code >= 500) return '#dc2626';
  if (code >= 400) return '#b45309';
  if (code >= 200 && code < 300) return '#059669';
  return 'var(--text3)';
}

export default function ApiEndpointMonitor() {
  const [data, setData] = useState<IntegrationMonitorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getIntegrationMonitor());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Monitoring endpoint gagal dimuat');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = data?.summary || {
    connectedApps:0, requests24h:0, dataPulls24h:0, errors24h:0, lastActivityAt:null,
  };
  const base = data?.baseEndpoint || (typeof window === 'undefined' ? '/api' : window.location.origin + '/api');
  const apps = data?.apps || [];
  const events = data?.events || [];
  const endpoints = data?.endpoints || [];
  const recentPull = useMemo(() => events.find((row) => row.event_type === 'DATA_PULL'), [events]);

  async function copyBase() {
    try {
      await navigator.clipboard.writeText(base);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return <section className="card" style={{ padding:18, display:'grid', gap:15 }} aria-label="ProQPay API monitoring">
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start', flexWrap:'wrap' }}>
      <div>
        <span style={{ color:'var(--text3)', fontSize:10.5, fontWeight:700, letterSpacing:'.08em' }}>PROQPAY API OBSERVABILITY</span>
        <h3 style={{ margin:'4px 0 0', fontSize:18 }}>Endpoint & Connected Apps</h3>
        <p style={{ color:'var(--text3)', fontSize:12, margin:'6px 0 0', maxWidth:700 }}>
          Memantau aplikasi eksternal yang mengakses endpoint ProQPay. Header monitoring hanya untuk identifikasi; otorisasi endpoint tetap berlaku seperti biasa.
        </p>
      </div>
      <button type="button" className="btn" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    {error ? <div className="app-notice-bubble app-notice-error" role="alert"><strong>Monitoring gagal</strong><span>{error}</span></div> : null}
    {data?.pendingMigration ? <div className="app-notice-bubble app-notice-info"><strong>Monitoring disiapkan</strong><span>Migration observability belum aktif pada database ini.</span></div> : null}

    <div className="operations-summary-grid" style={{ margin:0 }}>
      <div><span>Connected apps</span><strong>{summary.connectedApps}</strong><small>App ID yang pernah terlihat</small></div>
      <div><span>Requests 24 jam</span><strong>{summary.requests24h.toLocaleString('id-ID')}</strong><small>Traffic aplikasi eksternal</small></div>
      <div><span>Data pulls 24 jam</span><strong>{summary.dataPulls24h.toLocaleString('id-ID')}</strong><small>GET sukses ke endpoint data</small></div>
      <div><span>Errors 24 jam</span><strong>{summary.errors24h.toLocaleString('id-ID')}</strong><small>HTTP 4xx / 5xx</small></div>
    </div>

    <div style={{ display:'grid', gap:8 }}>
      <strong style={{ fontSize:12 }}>ProQPay API base endpoint</strong>
      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) auto', gap:8, alignItems:'center' }}>
        <code style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:11.5, padding:'9px 10px', border:'1px solid var(--border-soft)', borderRadius:9, background:'var(--bg-subtle)' }}>{base}</code>
        <button type="button" className="btn" onClick={() => void copyBase()}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <small style={{ color:'var(--text3)', lineHeight:1.55 }}>
        Untuk monitoring aplikasi, kirim header <code>X-ProQPay-App-Id</code> dan opsional <code>X-ProQPay-App-Name</code>. Header ini tidak memberikan akses; aplikasi tetap wajib lolos autentikasi endpoint ProQPay.
      </small>
    </div>

    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:12 }}>
      <div style={{ border:'1px solid var(--border-soft)', borderRadius:12, overflow:'hidden' }}>
        <div style={{ padding:'11px 13px', background:'var(--bg-subtle)', display:'flex', justifyContent:'space-between', gap:8 }}>
          <strong style={{ fontSize:11.5 }}>Connected applications</strong>
          <small style={{ color:'var(--text3)' }}>{apps.length}</small>
        </div>
        {apps.length ? <div style={{ maxHeight:300, overflow:'auto' }}>
          {apps.map((app) => <div key={app.app_id} style={{ padding:'11px 13px', borderTop:'1px solid var(--border-soft)', display:'grid', gap:4 }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}><strong style={{ fontSize:11.5 }}>{app.app_name}</strong><span style={{ fontSize:10, color:statusTone(app.last_status_code) }}>{app.last_status_code || '-'}</span></div>
            <code style={{ color:'var(--text3)', fontSize:9.5 }}>{app.app_id}</code>
            <span style={{ color:'var(--text3)', fontSize:10.5 }}>{app.last_endpoint || '-'} · {fmtDate(app.last_seen_at)}</span>
            <small style={{ color:'var(--text3)' }}>{Number(app.request_count).toLocaleString('id-ID')} request · {Number(app.data_pull_count).toLocaleString('id-ID')} data pull · {Number(app.error_count).toLocaleString('id-ID')} error</small>
          </div>)}
        </div> : <div style={{ padding:18, color:'var(--text3)', fontSize:11.5 }}>Belum ada aplikasi eksternal yang teridentifikasi.</div>}
      </div>

      <div style={{ border:'1px solid var(--border-soft)', borderRadius:12, overflow:'hidden' }}>
        <div style={{ padding:'11px 13px', background:'var(--bg-subtle)', display:'flex', justifyContent:'space-between', gap:8 }}>
          <strong style={{ fontSize:11.5 }}>Endpoint activity · 24h</strong>
          <small style={{ color:'var(--text3)' }}>{endpoints.length}</small>
        </div>
        {endpoints.length ? <div style={{ maxHeight:300, overflow:'auto' }}>
          {endpoints.map((row) => <div key={row.endpoint} style={{ padding:'11px 13px', borderTop:'1px solid var(--border-soft)', display:'grid', gap:4 }}>
            <code style={{ fontSize:10.5 }}>{row.endpoint}</code>
            <small style={{ color:'var(--text3)' }}>{Number(row.request_count).toLocaleString('id-ID')} request · {Number(row.data_pull_count).toLocaleString('id-ID')} pull · {Number(row.error_count).toLocaleString('id-ID')} error</small>
            <span style={{ color:'var(--text3)', fontSize:9.5 }}>Last: {fmtDate(row.last_seen_at)}</span>
          </div>)}
        </div> : <div style={{ padding:18, color:'var(--text3)', fontSize:11.5 }}>Belum ada endpoint yang ditarik aplikasi eksternal.</div>}
      </div>
    </div>

    <details style={{ borderTop:'1px solid var(--border-soft)', paddingTop:10 }}>
      <summary style={{ cursor:'pointer', fontSize:12, fontWeight:650 }}>Recent external API activity</summary>
      <div style={{ overflowX:'auto', marginTop:10 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
          <thead><tr><th style={th}>Waktu</th><th style={th}>App</th><th style={th}>Method</th><th style={th}>Endpoint</th><th style={th}>Type</th><th style={th}>Status</th><th style={th}>Latency</th></tr></thead>
          <tbody>{events.slice(0,40).map((row, index) => <tr key={row.created_at + row.app_id + index} style={{ borderBottom:'1px solid var(--border-soft)' }}>
            <td style={td}>{fmtDate(row.created_at)}</td><td style={td}>{row.app_name}</td><td style={td}>{row.method}</td><td style={td}><code>{row.endpoint}</code></td><td style={td}>{row.event_type.replaceAll('_',' ')}</td><td style={{ ...td, color:statusTone(row.status_code), fontWeight:700 }}>{row.status_code}</td><td style={td}>{row.duration_ms} ms</td>
          </tr>)}</tbody>
        </table>
        {!events.length ? <div style={{ padding:16, color:'var(--text3)', fontSize:11.5 }}>Belum ada aktivitas API eksternal.</div> : null}
      </div>
    </details>

    <small style={{ color:'var(--text3)' }}>
      Last activity: {fmtDate(summary.lastActivityAt)}{recentPull ? ' · Last data pull: ' + fmtDate(recentPull.created_at) : ''}
    </small>
  </section>;
}

const th: React.CSSProperties = { textAlign:'left', padding:'9px 10px', background:'var(--bg-subtle)', color:'var(--text2)', fontSize:9.5, textTransform:'uppercase', whiteSpace:'nowrap' };
const td: React.CSSProperties = { padding:'10px', verticalAlign:'middle', whiteSpace:'nowrap' };
