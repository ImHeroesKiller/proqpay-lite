'use client';

import { useState } from 'react';
import { formatIDRShort } from '@/lib/format';
import ActivityTimeline from './ActivityTimeline';
import { buildClientInsights } from '@/lib/client-insights';

export default function ClientDetail({ db }: { db: any }) {
  const clients = db.companies?.map((c: any) => c.name) || [];
  const [selected, setSelected] = useState(clients[0] || '');

  const info = {
    employees: db.employees?.filter((e: any) => e.company === selected) || [],
    projects: db.projects?.filter((p: any) => p.company === selected) || [],
    company: db.companies?.find((c: any) => c.name === selected),
    invoice: (db.invoices || []).find((i: any) => i.company === selected),
    ar: (db.arMonitor || []).find((a: any) => a.company === selected && a.status === 'OUTSTANDING'),
  };

  const regions: Record<string, number> = {};
  info.employees.forEach((e: any) => {
    if (e.region) regions[e.region] = (regions[e.region] || 0) + 1;
  });

  const insights = buildClientInsights(db, selected);

  return (
    <section style={{ marginTop: '36px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', gap: '16px', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>
          Client Detail
        </h2>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '8px 14px',
            borderRadius: 'var(--r-sm)',
            fontSize: '13px',
            fontWeight: 500,
            fontFamily: 'inherit',
            minWidth: '220px',
            outline: 'none',
          }}
        >
          {clients.map((c: string) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '16px',
      }}>
        {/* Employee List */}
        <div className="card" style={{ padding: '18px', gridColumn: '1 / -1' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
            Employee List <span style={{ fontWeight: 500, color: 'var(--text3)' }}>({info.employees.length})</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr>
                  {['ID', 'Name', 'Position', 'Status', 'Region', 'Salary'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '8px 10px',
                      background: 'var(--bg-subtle)', color: 'var(--text2)',
                      fontWeight: 600, fontSize: '11px', textTransform: 'uppercase'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {info.employees.slice(0, 5).map((e: any) => (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '8px 10px' }}>{e.id}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 500 }}>{e.name}</td>
                    <td style={{ padding: '8px 10px' }}>{e.position || '-'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        fontSize: '10px', padding: '2px 8px', borderRadius: '999px',
                        background: e.status === 'TETAP' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                        color: e.status === 'TETAP' ? '#059669' : '#d97706', fontWeight: 600
                      }}>{e.status}</span>
                    </td>
                    <td style={{ padding: '8px 10px' }}>{e.region || '-'}</td>
                    <td style={{ padding: '8px 10px' }}>{formatIDRShort(e.salaryGross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {info.employees.length > 5 && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text3)', textAlign: 'center' }}>
              Showing 5 of {info.employees.length} employees
            </div>
          )}
        </div>

        {/* Area / Region */}
        <div className="card" style={{ padding: '18px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
            Area / Region
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(regions).length === 0 && (
              <div style={{ fontSize: '13px', color: 'var(--text3)' }}>No regions</div>
            )}
            {Object.entries(regions).map(([r, c]) => (
              <div key={r} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--r-sm)'
              }}>
                <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{r}</span>
                <span style={{
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700
                }}>{c}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI Insight */}
        <div className="card" style={{ padding: '18px', borderColor: 'color-mix(in srgb, var(--violet) 22%, var(--border))' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
            🧠 AI Insight
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {insights.map((i, idx) => (
              <div key={idx} style={{
                display: 'flex', gap: '9px', alignItems: 'flex-start',
                padding: '10px 12px', background: 'var(--bg-subtle)',
                borderRadius: 'var(--r-md)', border: '1px solid var(--border-soft)'
              }}>
                <span style={{ fontSize: '15px', flexShrink: 0 }}>{i.icon}</span>
                <span style={{ fontSize: '12.5px', lineHeight: 1.45 }}>{i.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Billing */}
        <div className="card" style={{ padding: '18px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
            Billing Information
          </div>
          {info.invoice ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text2)' }}>Invoice ID</span>
                <strong>{info.invoice.id}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text2)' }}>Amount</span>
                <strong>{formatIDRShort(info.invoice.totalAmount)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text2)' }}>Status</span>
                <span style={{
                  fontSize: '10px', padding: '2px 8px', borderRadius: '999px', fontWeight: 600,
                  background: info.invoice.status === 'PAID' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                  color: info.invoice.status === 'PAID' ? '#059669' : '#d97706'
                }}>{info.invoice.status}</span>
              </div>
              {info.ar && (
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid var(--border-soft)' }}>
                  <span style={{ color: 'var(--text2)' }}>AR Outstanding</span>
                  <strong style={{ color: 'var(--orange)' }}>{formatIDRShort(info.ar.amount)}</strong>
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text3)' }}>No invoice this period</div>
          )}
        </div>

        {/* Activity Timeline */}
        <ActivityTimeline logs={db.auditLogs || []} />
      </div>
    </section>
  );
}
