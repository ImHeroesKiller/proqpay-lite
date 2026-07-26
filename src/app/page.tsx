'use client';

import { useEffect, useState } from 'react';
import { loadDatabase } from '@/lib/database';
import { formatIDRShort } from '@/lib/format';
import Sidebar from '@/components/Sidebar';

export default function Home() {
  const [db, setDb] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const data = loadDatabase();
    setDb(data);
  }, []);

  if (!mounted || !db) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text3)' }}>Loading ProQPay Lite…</p>
      </div>
    );
  }

  const empCount = db.employees?.length || 0;
  const clientCount = db.companies?.length || 0;
  const projectCount = db.projects?.length || 0;
  const currentPayroll = db.payrolls?.find((p: any) => p.period === db.meta?.currentPeriod);
  const totalNet = currentPayroll?.summary?.totalNet || 0;
  const outstanding = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
  const totalOutstanding = outstanding.reduce((s: number, a: any) => s + a.amount, 0);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <header style={{
          height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', background: 'rgba(255,255,255,0.85)', borderBottom: '1px solid var(--border)',
          backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.02em' }}>
              ProQPay <span style={{ color: 'var(--orange)' }}>Lite</span>
            </div>
            <span style={{
              fontSize: '11px', fontWeight: 600, color: 'var(--accent)',
              padding: '4px 10px', border: '1px solid var(--accent-soft2)',
              background: 'var(--accent-soft)', borderRadius: 'var(--r-pill)'
            }}>AI Payroll OS</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              fontSize: '12px', padding: '5px 12px', borderRadius: 'var(--r-pill)',
              background: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text2)', fontWeight: 500
            }}>{db.meta?.currentPeriod || '2025-07'}</span>
            <span style={{
              fontSize: '12px', padding: '5px 12px', borderRadius: 'var(--r-pill)',
              background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600
            }}>Super Admin</span>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px', letterSpacing: '-0.02em' }}>
              Global Snapshot
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>
              All Clients · {db.meta?.currentPeriod}
            </p>

            {/* Metric Cards */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '14px', marginBottom: '24px'
            }}>
              <MetricCard label="Employees" value={String(empCount)} sub={`${clientCount} client · ${projectCount} project`} accent="var(--cyan)" />
              <MetricCard label="Clients" value={String(clientCount)} sub={`${projectCount} project aktif`} accent="var(--teal)" />
              <MetricCard label="Payroll Net" value={formatIDRShort(totalNet)} sub={currentPayroll ? currentPayroll.status : 'Belum dihitung'} accent="var(--accent)" />
              <MetricCard label="Outstanding" value={formatIDRShort(totalOutstanding)} sub={`${outstanding.length} klien`} accent="var(--orange)" />
            </div>

            {/* Client Overview */}
            <div className="card" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '14px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Client Overview
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {db.companies?.map((c: any) => {
                  const empOfClient = db.employees.filter((e: any) => e.company === c.name).length;
                  const projOfClient = db.projects.filter((p: any) => p.company === c.name).length;
                  return (
                    <div key={c.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)'
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '14px' }}>{c.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                          {empOfClient} emp · {projOfClient} project · {c.payrollType}
                        </div>
                      </div>
                      <span style={{
                        fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--r-pill)',
                        background: 'rgba(16,185,129,0.12)', color: '#059669'
                      }}>ACTIVE</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <p style={{ marginTop: '28px', fontSize: '12px', color: 'var(--text3)', textAlign: 'center' }}>
              ProQPay Lite · Next.js 16 ·{' '}
              <a href="https://github.com/ImHeroesKiller/proqpay-lite">GitHub</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="card" style={{ padding: '18px', position: 'relative', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px',
        background: accent, opacity: 0.7
      }} />
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: '4px' }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{sub}</div>
    </div>
  );
}
