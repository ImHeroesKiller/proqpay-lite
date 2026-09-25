'use client';

import type { ApiEndpointEvent, PageMeta } from '@/lib/integration-monitor-api';
import { IntegrationPagination } from './IntegrationPrimitives';

function fmtDate(value?: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('id-ID');
}

export function IntegrationActivity({
  events,
  page,
  loading,
  refreshing,
  copied,
  onCopy,
  onTrace,
  onPage,
}: {
  events:ApiEndpointEvent[];
  page:PageMeta;
  loading:boolean;
  refreshing:boolean;
  copied:string;
  onCopy:(label:string,value:string)=>void;
  onTrace?:(correlationId:string)=>void;
  onPage:(offset:number)=>void;
}) {
  return <div className="integration-panel">
    <div className="integration-panel-head"><div><strong>API activity</strong><small>Server-side filter & pagination</small></div><span>{page.total}</span></div>
    <div className="integration-events-desktop">
      <table className="integration-events-table">
        <caption className="sr-only">Aktivitas API eksternal ProQPay</caption>
        <thead><tr><th>Waktu</th><th>App</th><th>Method</th><th>Endpoint</th><th>Type</th><th>Status</th><th>Latency</th><th>Correlation</th></tr></thead>
        <tbody>{events.map((row, index) => <tr key={row.created_at + row.app_id + index}>
          <td>{fmtDate(row.created_at)}</td><td>{row.app_name}</td><td>{row.method}</td><td><code>{row.endpoint}</code></td><td>{row.event_type.replaceAll('_',' ')}</td><td><strong>{row.status_code}</strong></td><td>{row.duration_ms} ms</td>
          <td><div className="integration-correlation-actions"><button type="button" className="integration-copy-id" aria-label={`Salin correlation ID ${row.correlation_id || 'tidak tersedia'}`} onClick={() => onCopy(row.correlation_id || '', row.correlation_id || '')}>{copied === row.correlation_id ? 'Copied' : row.correlation_id || '-'}</button>{row.correlation_id && onTrace ? <button type="button" className="integration-trace-link" onClick={() => onTrace(row.correlation_id!)}>Open Audit Logs</button> : null}</div></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="integration-events-mobile" aria-label="Aktivitas API eksternal">
      {events.map((row, index) => <article key={row.created_at + row.app_id + index}>
        <div><strong>{row.method} {row.endpoint}</strong><span>HTTP {row.status_code}</span></div>
        <small>{row.app_name} · {row.event_type.replaceAll('_',' ')} · {row.duration_ms} ms</small>
        <span>{fmtDate(row.created_at)}</span>
        <div className="integration-correlation-actions"><button type="button" className="integration-copy-id" aria-label={`Salin correlation ID ${row.correlation_id || 'tidak tersedia'}`} onClick={() => onCopy(row.correlation_id || '', row.correlation_id || '')}>Correlation: {row.correlation_id || '-'}</button>{row.correlation_id && onTrace ? <button type="button" className="integration-trace-link" onClick={() => onTrace(row.correlation_id!)}>Open Audit Logs</button> : null}</div>
      </article>)}
    </div>
    {!events.length && !loading ? <div className="integration-empty">Tidak ada API activity yang cocok dengan filter.</div> : null}
    <IntegrationPagination
      offset={page.offset}
      limit={page.limit}
      total={page.total}
      count={events.length}
      disabled={refreshing}
      onPrevious={() => onPage(Math.max(0, page.offset - page.limit))}
      onNext={() => onPage(page.offset + page.limit)}
    />
  </div>;
}
