'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIntegrationMonitor } from '@/hooks/useIntegrationMonitor';
import { apiRecoveryGuidance, integrationHealthLabel } from '@/lib/integration-health';
import { IntegrationHealthPill, IntegrationPagination } from '@/components/integrations/IntegrationPrimitives';
import { IntegrationFilterBar } from '@/components/integrations/IntegrationFilterBar';
import { IntegrationActivity } from '@/components/integrations/IntegrationActivity';
import {
  updateIntegrationAppStatus,
  type IntegrationMonitorResponse,
  type MonitorFilters,
} from '@/lib/integration-monitor-api';

function fmtDate(value?: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('id-ID');
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

  const { data, loading, refreshing, error, retryCount, load, setError } = useIntegrationMonitor(filters, EMPTY);

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

  const recoveryText = apiRecoveryGuidance(health.state);

  return <section className="card integrations-monitor" aria-label="ProQPay API monitoring">
    <div className="integrations-section-head">
      <div>
        <span className="workspace-eyebrow">PROQPAY API OBSERVABILITY</span>
        <h3>Endpoint & External Apps</h3>
        <p>Health, traffic, error, latency, trust status, dan correlation tracing untuk seluruh aplikasi eksternal.</p>
      </div>
      <div className="integrations-head-actions">
        <IntegrationHealthPill state={health.state} />
        <button type="button" className="btn" disabled={refreshing} onClick={() => void load('refresh')}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </div>

    <div className="sr-only" aria-live="polite">{refreshing ? 'Memperbarui data integrasi' : ''}</div>
    {error ? <div className="app-notice-bubble app-notice-error" role="alert">
      <strong>Monitoring gagal dimuat</strong>
      <span>{error}{retryCount > 1 ? ` · retry ${retryCount}x belum berhasil` : ''}</span>
      <button type="button" className="btn" disabled={refreshing} onClick={() => void load('retry')}>Retry sekarang</button>
    </div> : null}
    {data.pendingMigration ? <div className="app-notice-bubble app-notice-info"><strong>Monitoring disiapkan</strong><span>Migration observability belum aktif pada database ini.</span></div> : null}

    <div className="integration-health-banner" data-state={health.state}>
      <div><span>System health</span><strong>{integrationHealthLabel(health.state)}</strong><small>{health.reason}</small></div>
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

    <IntegrationFilterBar
      value={{ q, appStatus, eventType, statusClass, from, to }}
      disabled={refreshing}
      onChange={(patch) => {
        if (patch.q !== undefined) setQ(patch.q);
        if (patch.appStatus !== undefined) setAppStatus(patch.appStatus);
        if (patch.eventType !== undefined) setEventType(patch.eventType);
        if (patch.statusClass !== undefined) setStatusClass(patch.statusClass);
        if (patch.from !== undefined) setFrom(patch.from);
        if (patch.to !== undefined) setTo(patch.to);
      }}
      onReset={resetFilters}
    />

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
        <IntegrationPagination
          offset={appPage.offset}
          limit={appPage.limit}
          total={appPage.total}
          count={data.apps.length}
          disabled={refreshing}
          onPrevious={() => setAppOffset(Math.max(0, appPage.offset - appPage.limit))}
          onNext={() => setAppOffset(appPage.offset + appPage.limit)}
        />
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

    <IntegrationActivity
      events={data.events}
      page={eventPage}
      loading={loading}
      refreshing={refreshing}
      copied={copied}
      onCopy={(label, value) => void copy(label, value)}
      onPage={setEventOffset}
    />

    <div className="integration-monitor-foot">
      <span>Last activity: {fmtDate(summary.lastActivityAt)}{recentPull ? ' · Last data pull: ' + fmtDate(recentPull.created_at) : ''}</span>
      <span>Retention: {data.retentionDays || 30} hari · Auto-refresh 30 detik saat tab aktif</span>
    </div>
  </section>;
}
