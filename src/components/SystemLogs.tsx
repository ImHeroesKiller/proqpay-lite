'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  clearSystemLogs,
  loadSystemLogs,
  onSystemLogChange,
  type SystemLogEntry,
  type SystemLogLevel,
} from '@/lib/system-log';
import PortalAudit from '@/components/PortalAudit';

const LEVEL_COLOR: Record<SystemLogLevel, string> = {
  INFO: '#60a5fa',
  SUCCESS: '#34d399',
  WARN: '#fbbf24',
  ERROR: '#fb7185',
};

function clock(value: number) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
}

export default function SystemLogs({ auditLogs = [], initialTab = 'system' }: { auditLogs?: any[]; initialTab?: 'system' | 'logins' | 'events' }) {
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [level, setLevel] = useState<'ALL' | SystemLogLevel>('ALL');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'system' | 'logins' | 'events'>(initialTab);

  useEffect(() => {
    const refresh = () => setLogs(loadSystemLogs());
    refresh();
    return onSystemLogChange(refresh);
  }, []);

  const merged = useMemo(() => {
    const auditEntries: SystemLogEntry[] = auditLogs.map((item) => ({
      id: `audit-${item.id}`,
      timestamp: Number(item.timestamp || 0),
      level: 'INFO',
      source: 'BUSINESS',
      event: String(item.action || 'AUDIT'),
      message: String(item.detail || ''),
      meta: { user: item.user, role: item.role, entity: item.entity },
    }));
    return [...logs, ...auditEntries].sort((a, b) => b.timestamp - a.timestamp);
  }, [logs, auditLogs]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return merged.filter((item) => {
      if (level !== 'ALL' && item.level !== level) return false;
      if (!query) return true;
      return [item.source, item.event, item.message, JSON.stringify(item.meta || {})]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [merged, level, search]);

  return (
    <section className="audit-hub">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span className="page-eyebrow">Governance & security</span>
          <h2 style={{ fontSize: 22, fontWeight: 720, margin: 0 }}>Audit & Portal Logs</h2>
          <p style={{ color: 'var(--text3)', fontSize: 13, margin: '4px 0 0' }}>
            Jejak sistem, aktivitas bisnis, login ESS, dan Advance Salary dalam satu pusat audit.
          </p>
        </div>
        {tab === 'system' ? <button type="button" className="btn" onClick={clearSystemLogs}>Bersihkan log lokal</button> : null}
      </div>

      <div className="portal-toolbar audit-tabs">
        <button type="button" className={`btn${tab === 'system' ? ' btn-primary' : ''}`} onClick={() => setTab('system')}>System & bisnis</button>
        <button type="button" className={`btn${tab === 'logins' ? ' btn-primary' : ''}`} onClick={() => setTab('logins')}>Login ESS</button>
        <button type="button" className={`btn${tab === 'events' ? ' btn-primary' : ''}`} onClick={() => setTab('events')}>Advance & portal</button>
      </div>

      {tab !== 'system' ? <PortalAudit embedded mode={tab} /> : <div className="card" style={{ marginTop: 16, overflow: 'hidden', background: '#08111f', borderColor: '#1e293b' }}>
        <div style={{ display: 'flex', gap: 8, padding: 12, borderBottom: '1px solid #1e293b', flexWrap: 'wrap' }}>
          <input
            aria-label="Cari log"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari event, sumber, atau pesan…"
            style={{ flex: '1 1 240px', minWidth: 0, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', borderRadius: 8, padding: '9px 12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
          />
          <select
            aria-label="Filter level log"
            value={level}
            onChange={(event) => setLevel(event.target.value as 'ALL' | SystemLogLevel)}
            style={{ border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', borderRadius: 8, padding: '9px 12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
          >
            {['ALL', 'INFO', 'SUCCESS', 'WARN', 'ERROR'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>

        <div style={{ height: 'min(66vh, 680px)', overflow: 'auto', padding: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, lineHeight: 1.65, color: '#cbd5e1', contentVisibility: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ color: '#64748b' }}>$ Belum ada event yang cocok.</div>
          ) : filtered.map((item) => (
            <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '148px 64px 110px minmax(140px, 1fr)', gap: 10, padding: '5px 0', borderBottom: '1px solid rgba(51,65,85,.35)', minWidth: 680 }}>
              <span style={{ color: '#64748b' }}>{clock(item.timestamp)} WIB</span>
              <strong style={{ color: LEVEL_COLOR[item.level] }}>{item.level}</strong>
              <span style={{ color: 'var(--accent)' }}>[{item.source}]</span>
              <span><b style={{ color: '#f8fafc' }}>{item.event}</b> — {item.message}{item.meta ? <span style={{ color: '#64748b' }}> {JSON.stringify(item.meta)}</span> : null}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid #1e293b', color: '#64748b', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>
          $ {filtered.length} event ditampilkan · maksimum 500 log teknis lokal
        </div>
      </div>}
    </section>
  );
}
