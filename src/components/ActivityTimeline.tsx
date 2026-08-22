'use client';

import { useMemo, useState } from 'react';
import { formatDate } from '@/lib/format';
import PanelPagination from './PanelPagination';

export default function ActivityTimeline({ logs, pageSize = 5 }: { logs: any[]; pageSize?: number }) {
  const [page, setPage] = useState(1);
  const items = useMemo(() => [...(logs || [])].reverse(), [logs]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = items.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="card client-detail-panel activity-panel">
      <div className="client-panel-heading"><div><span>Audit</span><h3>Activity Timeline</h3></div><small>{items.length} event</small></div>
      {!items.length ? <div className="client-panel-empty">Belum ada aktivitas terbaru.</div> : (
        <div key={safePage} className="activity-list paginated-content">
          {visible.map((log: any) => {
            const color = log.action?.includes('PAYROLL') ? '#3b82f6' : log.action?.includes('PAYMENT') || log.action?.includes('APPROVED') ? '#10b981' : '#94a3b8';
            return (
              <div key={log.id} className="activity-item">
                <i style={{ background: color, boxShadow: `0 0 0 3px ${color}22` }} />
                <div><strong>{(log.action || '').replace(/_/g, ' ').toLowerCase()}</strong><p>{log.detail}</p><small>{formatDate(log.timestamp)} · {log.user}</small></div>
              </div>
            );
          })}
        </div>
      )}
      <PanelPagination page={safePage} pageCount={pageCount} total={items.length} label="aktivitas" onPage={setPage} />
    </div>
  );
}
