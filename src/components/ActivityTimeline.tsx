'use client';

import { formatDate } from '@/lib/format';

export default function ActivityTimeline({ logs }: { logs: any[] }) {
  const items = (logs || []).slice(-6).reverse();

  if (items.length === 0) {
    return (
      <div className="card" style={{ padding: '18px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
          Activity Timeline
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text3)' }}>No recent activity</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '18px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
        Activity Timeline
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        {items.map((l: any) => {
          const color =
            l.action?.includes('PAYROLL') ? '#3b82f6' :
            l.action?.includes('PAYMENT') ? '#10b981' :
            l.action?.includes('APPROVED') ? '#8b5cf6' : '#94a3b8';
          return (
            <div key={l.id} style={{ display: 'flex', gap: '11px' }}>
              <div style={{
                width: '9px', height: '9px', borderRadius: '50%',
                background: color, marginTop: '4px', flexShrink: 0,
                boxShadow: `0 0 0 3px ${color}22`
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '11.5px', fontWeight: 600, textTransform: 'capitalize' }}>
                  {(l.action || '').replace(/_/g, ' ').toLowerCase()}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text2)', marginTop: '2px', lineHeight: 1.45 }}>
                  {l.detail}
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--text3)', marginTop: '2px' }}>
                  {formatDate(l.timestamp)} · {l.user}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
