'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  getIntegrationMonitor,
  updateIntegrationAppStatus,
  type HealthState,
  type IntegrationMonitorResponse,
  type MonitorFilters,
} from '@/lib/integration-monitor-api';

function fmtDate(value?: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('id-ID');
}

function healthLabel(state: HealthState) {
  return state === 'HEALTHY' ? 'Healthy' : state === 'DEGRADED' ? 'Degraded' : state === 'DOWN' ? 'Down' : 'Idle';
}

function statusLabel(status: string) {
  return status === 'ACTIVE' ? 'Trusted' : status === 'OBSERVED' ? 'Observed' : status === 'INACTIVE' ? 'Inactive' : 'Revoked';
}

function pct(value?: number) {
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

const EMPTY: IntegrationMonitorResponse = {
  ok:true,
  baseEndpoint:'/api',
  summary:{ connectedApps:0,trustedApps:0,observedApps:0,requests24h:0,dataPulls24h:0,errors24h:0,lastActivityAt:null },
  apps:[],
  events:[],
  endpoints:[],
  health:{ state:'IDLE', reason:'Belum ada data monitoring', errorRate:0 },
  diagnostics:{ errorRate24h:0,slowEndpoints:0,failingEndpoints:0 },
  appPage:{ offset:0,limit:20,total:0,hasMore:false },
  eventPage:{ offset:0,limit:25,total:0,hasMore:false },
};

export default function ApiEndpointMonitor() {
  const [data, setData] = useState<IntegrationMonitorResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [copied, setCopied] = useState('');
  const [appBusy, setAppBusy] = useState('');
  const [q, setQ] = useState('');
  const [appStatus, setAppStatus] = useState('');
  const [eventType, setEventType] = useState('');
  const [statusClass, setStatusClass] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [eventOffset, setEventOffset] = useState(0);
  const [appOffset, setAppOffset] = useState(0);
  const qDebounced = useDebouncedValue(q, 300);
  const abortRef = useRef<AbortController | null>(null);
  const initializedRef = useRef(false);

  const filters = useMemo<MonitorFilters>(() => ({
    q:qDebounced.trim(),
    appStatus,
    eventType,
    statusClass,
    from,
    to,
    eventOffset,
    eventLimit:25,
    appOffset,
    appLimit:20,
  }), [qDebounced, appStatus, eventType, statusClass, from, to, eventOffset, appOffset]);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'retry' = 'refresh') => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const next = await getIntegrationMonitor(filters, controller.signal);
      setData(next);
      setRetryCount(0);
      initializedRef.current = true;
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRetryCount((value) => value + 1);
      setError(cause instanceof Error ? cause.message : 'Monitoring endpoint gagal dimuat');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filters]);

  useEffect(() => {
    void load(initializedRef.current ? 'refresh' : 'initial');
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !error) void load('refresh');
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load, error]);

  useEffect(() => {
    setEventOffset(0);
    setAppOffset(0);
  }, [qDebounced, appStatus, eventType, statusClass, from, to]);

  const summary = data.summary || EMPTY.summary;
  const health = data.health || EMPTY.health!;
  const diagnostics = data.diagnostics || EMPTY.diagnostics!;
  const base = data.baseEndpoint || (typeof window === 'undefined' ? '/api' : window.location.origin + '/api');
  const appPage = data.appPage || EMPTY.appPage!;
  const eventPage = data.eventPage || EMPTY.eventPage!;
  const recentPull = useMemo(() => data.events.find((row) => row.event_type === 'DATA_PULL'), [data.events]);
  const hasFilters = Boolean(q || appStatus || eventType || statusClass || from || to);

  async function changeAppStatus(appId: string, action: 'ACTIVATE' | 'DEACTIVATE' | 'REVOKE') {
    setAppBusy(appId + ':' + action);
    setError('');
    try {
      await updateIntegrationAppStatus(appId, action);
      await load('refresh');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Status aplikasi gagal diubah');
    } finally {
      setAppBusy('');
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1400);
    } catch {
      setCopied('');
    }
  }

  function resetFilters() {
    setQ('');
    setAppStatus('');
    setEventType('');
    setStatusClass('');
    setFrom('');
    setTo('');
    setEventOffset(0);
    setAppOffset(0);
  }

  const recoveryText = health.state === 'DOWN'
    ? 'Periksa endpoint dengan error tertinggi, buka Audit Logs memakai Correlation ID, lalu retry setelah akar masalah diperbaiki.'
    : health.state === 'DEGRADED'
      ? 'Prioritaskan endpoint lambat/error dan validasi perubahan terakhir sebelum traffic meningkat.'
      : health.state === 'IDLE'
        ? 'Belum ada traffic. Pastikan aplikasi eksternal mengirim App ID monitoring dan tetap memakai autentikasi ProQPay.'
        : 'Tidak ada recovery action yang diperlukan saat ini.';

  return <section className="card integrations-monitor" aria-label="ProQPay API monitoring">
    <div className="integrations-section-head">
      <div>
        <span className="workspace-eyebrow">PROQPAY API OBSERVABILITY</span>
        <h3>Endpoint & External Apps</h3>
        <p>Health, traffic, error, latency, trust status, dan correlation tracing untuk seluruh aplikasi eksternal.</p>
      </div>
      <div className="integrations-head-actions">
        <span className={`integration-health-pill integration-health-${health.state.toLowerCase()}`}>{healthLabel(health.state)}</span>
        <button type="button" className="btn" disabled={refreshing} onClick={() => void load('refresh')}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </div>

    {error ? <div className="app-notice-bubble app-notice-error" role="alert">
      <strong>Monitoring gagal dimuat</strong>
      <span>{error}{retryCount > 1 ? ` · retry ${retryCount}x belum berhasil` : ''}</span>
      <button type="button" className="btn" disabled={refreshing} onClick={() => void load('retry')}>Retry sekarang</button>
    </div> : null}
    {data.pendingMigration ? <div className="app-notice-bubble app-notice-info"><strong>Monitoring disiapkan</strong><span>Migration observability belum aktif pada database ini.</span></div> : null}

    <div className="integration-health-banner" data-state={health.state}>
      <div><span>System health</span><strong>{healthLabel(health.state)}</strong><small>{health.reason}</small></div>
      <div><span>Error rate 24h</span><strong>{pct(diagnostics.errorRate24h)}</strong><small>{summary.errors24h.toLocaleString('id-ID')} dari {summary.requests24h.toLocaleString('id-ID')} request</small></div>
      <div><span>Endpoint bermasalah</span><strong>{diagnostics.failingEndpoints}</strong><small>{diagnostics.slowEndpoints} endpoint avg latency ≥ 1 detik</small></div>
      <div><span>Recovery guidance</span><strong>{health.state === 'HEALTHY' ? 'No action' : 'Action needed'}</strong><small>{recoveryText}</small></div>
    </div>

    <div className="operations-summary-grid integrations-kpis">
      <div><span>Trusted apps</span><strong>{summary.trustedApps ?? summary.connectedApps}</strong><small>ACTIVE oleh Super Admin</small></div>
      <div><span>Observed apps</span><strong>{summary.observedApps ?? 0}</strong><small>Belum di-trust</small></div>
      <div><span>Requests 24 jam</span><strong>{summary.requests24h.toLocaleString('id-ID')}</strong><small>External API traffic</small></div>
      <div><span>Data pulls 24 jam</span><strong>{summary.dataPulls24h.toLocaleString('id-ID')}</strong><small>Successful GET data</small></div>
      <div><span>Errors 24 jam</span><strong>{summary.errors24h.toLocaleString('id-ID')}</strong><small>HTTP 4xx / 5xx</small></div>
    </div>

    <div className="integration-endpoint-copy">
      <div><strong>ProQPay API base endpoint</strong><small>Monitoring header tidak memberikan akses API; autentikasi endpoint tetap wajib.</small></div>
      <code title={base}>{base}</code>
      <button type="button" className="btn" onClick={() => void copy('base', base)}>{copied === 'base' ? 'Copied' : 'Copy'}</button>
    </div>

    <div className="integration-filter-panel">
      <label><span>Search</span><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="App, endpoint, correlation ID…" /></label>
      <label><span>App status</span><select value={appStatus} onChange={(event) => setAppStatus(event.target.value)}><option value="">Semua</option><option value="ACTIVE">Trusted</option><option value="OBSERVED">Observed</option><option value="INACTIVE">Inactive</option><option value="REVOKED">Revoked</option></select></label>
      <label><span>Event type</span><select value={eventType} onChange={(event) => setEventType(event.target.value)}><option value="">Semua</option><option value="CONNECTION">Connection</option><option value="DATA_PULL">Data pull</option><option value="REQUEST">Request</option></select></label>
      <label><span>HTTP result</span><select value={statusClass} onChange={(event) => setStatusClass(event.target.value)}><option value="">Semua</option><option value="SUCCESS">2xx/3xx</option><option value="ERROR">4xx/5xx</option></select></label>
      <label><span>Dari</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>Sampai</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button type="button" className="btn" disabled={!hasFilters} onClick={resetFilters}>Reset filter</button>
    </div>

    <div className="integrations-two-col">
      <div className="integration-panel">
        <div className="integration-panel-head"><div><strong>External applications</strong><small>Trust lifecycle</small></div><span>{appPage.total}</span></div>
        {loading ? <div className="integration-empty">Memuat applications…</div> : data.apps.length ? <div className="integration-list">
          {data.apps.map((app) => <article key={app.app_id} className="integration-app-row">
            <div className="integration-row-title"><strong>{app.app_name}</strong><span className={`integration-app-status integration-app-${app.status.toLowerCase()}`}>{statusLabel(app.status)}</span></div>
            <code>{app.app_id}</code>
            <span>{app.last_endpoint || '-'} · HTTP {app.last_status_code || '-'} · {fmtDate(app.last_seen_at)}</span>
            <small>{Number(app.request_count).toLocaleString('id-ID')} request · {Number(app.data_pull_count).toLocaleString('id-ID')} pull · {Number(app.error_count).toLocaleString('id-ID')} error</small>
            {app.status !== 'REVOKED' ? <div className="integration-row-actions">
              {app.status !== 'ACTIVE'
                ? <button type="button" className="btn" disabled={Boolean(appBusy)} onClick={() => void changeAppStatus(app.app_id, 'ACTIVATE')}>{appBusy === app.app_id + ':ACTIVATE' ? 'Updating…' : 'Mark Active'}</button>
                : <button type="button" className="btn" disabled={Boolean(appBusy)} onClick={() => void changeAppStatus(app.app_id, 'DEACTIVATE')}>{appBusy === app.app_id + ':DEACTIVATE' ? 'Updating…' : 'Deactivate'}</button>}
              <button type="button" className="btn" disabled={Boolean(appBusy)} onClick={() => void changeAppStatus(app.app_id, 'REVOKE')}>{appBusy === app.app_id + ':REVOKE' ? 'Revoking…' : 'Revoke'}</button>
            </div> : <small>Revoked bersifat terminal. Gunakan App ID baru untuk reconnect.</small>}
          </article>)}
        </div> : <div className="integration-empty">Tidak ada aplikasi yang cocok dengan filter.</div>}
        <div className="integration-pagination">
          <button type="button" className="btn" disabled={appPage.offset <= 0 || refreshing} onClick={() => setAppOffset(Math.max(0, appPage.offset - appPage.limit))}>Sebelumnya</button>
          <span>{appPage.total ? appPage.offset + 1 : 0}–{Math.min(appPage.offset + data.apps.length, appPage.total)} dari {appPage.total}</span>
          <button type="button" className="btn" disabled={!appPage.hasMore || refreshing} onClick={() => setAppOffset(appPage.offset + appPage.limit)}>Berikutnya</button>
        </div>
      </div>

      <div className="integration-panel">
        <div className="integration-panel-head"><div><strong>Endpoint diagnostics</strong><small>24 jam terakhir</small></div><span>{data.endpoints.length}</span></div>
        {data.endpoints.length ? <div className="integration-list">
          {data.endpoints.map((row) => {
            const errorRate = Number(row.request_count) ? Number(row.error_count) / Number(row.request_count) : 0;
            return <article key={row.endpoint} className="integration-endpoint-row">
              <div className="integration-row-title"><code>{row.endpoint}</code><span>{pct(errorRate)} error</span></div>
              <small>{Number(row.request_count).toLocaleString('id-ID')} request · avg {Number(row.avg_duration_ms || 0).toLocaleString('id-ID')} ms · max {Number(row.max_duration_ms || 0).toLocaleString('id-ID')} ms</small>
              <span>Last activity: {fmtDate(row.last_seen_at)}</span>
            </article>;
          })}
        </div> : <div className="integration-empty">Belum ada endpoint activity.</div>}
      </div>
    </div>

    <div className="integration-panel">
      <div className="integration-panel-head"><div><strong>API activity</strong><small>Server-side filter & pagination</small></div><span>{eventPage.total}</span></div>
      <div className="integration-events-desktop">
        <table className="integration-events-table">
          <thead><tr><th>Waktu</th><th>App</th><th>Method</th><th>Endpoint</th><th>Type</th><th>Status</th><th>Latency</th><th>Correlation</th></tr></thead>
          <tbody>{data.events.map((row, index) => <tr key={row.created_at + row.app_id + index}>
            <td>{fmtDate(row.created_at)}</td><td>{row.app_name}</td><td>{row.method}</td><td><code>{row.endpoint}</code></td><td>{row.event_type.replaceAll('_',' ')}</td><td><strong>{row.status_code}</strong></td><td>{row.duration_ms} ms</td><td><button type="button" className="integration-copy-id" onClick={() => void copy(row.correlation_id || '', row.correlation_id || '')}>{copied === row.correlation_id ? 'Copied' : row.correlation_id || '-'}</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="integration-events-mobile">
        {data.events.map((row, index) => <article key={row.created_at + row.app_id + index}>
          <div><strong>{row.method} {row.endpoint}</strong><span>HTTP {row.status_code}</span></div>
          <small>{row.app_name} · {row.event_type.replaceAll('_',' ')} · {row.duration_ms} ms</small>
          <span>{fmtDate(row.created_at)}</span>
          <button type="button" className="integration-copy-id" onClick={() => void copy(row.correlation_id || '', row.correlation_id || '')}>Correlation: {row.correlation_id || '-'}</button>
        </article>)}
      </div>
      {!data.events.length && !loading ? <div className="integration-empty">Tidak ada API activity yang cocok dengan filter.</div> : null}
      <div className="integration-pagination">
        <button type="button" className="btn" disabled={eventPage.offset <= 0 || refreshing} onClick={() => setEventOffset(Math.max(0, eventPage.offset - eventPage.limit))}>Sebelumnya</button>
        <span>{eventPage.total ? eventPage.offset + 1 : 0}–{Math.min(eventPage.offset + data.events.length, eventPage.total)} dari {eventPage.total}</span>
        <button type="button" className="btn" disabled={!eventPage.hasMore || refreshing} onClick={() => setEventOffset(eventPage.offset + eventPage.limit)}>Berikutnya</button>
      </div>
    </div>

    <div className="integration-monitor-foot">
      <span>Last activity: {fmtDate(summary.lastActivityAt)}{recentPull ? ' · Last data pull: ' + fmtDate(recentPull.created_at) : ''}</span>
      <span>Retention: {data.retentionDays || 30} hari · Auto-refresh 30 detik saat tab aktif</span>
    </div>
  </section>;
}
