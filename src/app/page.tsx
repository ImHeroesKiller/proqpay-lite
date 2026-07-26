'use client';

import { useEffect, useState } from 'react';
import { loadDatabase } from '@/lib/database';
import { formatIDR, formatIDRShort } from '@/lib/format';

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
      <main style={{ padding: '40px', fontFamily: 'Inter, sans-serif' }}>
        <p style={{ color: '#94a3b8' }}>Loading ProQPay Lite…</p>
      </main>
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
    <main style={{ minHeight: '100vh', background: '#f7f8fb', fontFamily: 'Inter, -apple-system, sans-serif' }}>
      {/* Topbar */}
      <header style={{
        height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', background: 'rgba(255,255,255,0.85)', borderBottom: '1px solid #eaeef4',
        backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: '10px',
            background: 'linear-gradient(135deg, #5b5ef0, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: '13px'
          }}>PQ</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.02em' }}>
              ProQPay <span style={{ color: '#f97316' }}>Lite</span>
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>AI Payroll OS</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '12px', padding: '5px 12px', borderRadius: '999px',
            background: '#f4f6fa', border: '1px solid #eaeef4', color: '#5a6478', fontWeight: 500
          }}>{db.meta?.currentPeriod || '2025-07'}</span>
          <span style={{
            fontSize: '12px', padding: '5px 12px', borderRadius: '999px',
            background: 'rgba(91,94,240,0.1)', color: '#5b5ef0', fontWeight: 600
          }}>Super Admin</span>
        </div>
      </header>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '28px 24px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px', letterSpacing: '-0.02em' }}>
          Global Snapshot
        </h2>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px' }}>
          All Clients · {db.meta?.currentPeriod}
        </p>

        {/* Metric Cards */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '14px', marginBottom: '24px'
        }}>
          <MetricCard label="Employees" value={String(empCount)} sub={`${clientCount} client · ${projectCount} project`} accent="#06b6d4" />
          <MetricCard label="Clients" value={String(clientCount)} sub={`${projectCount} project aktif`} accent="#14b8a6" />
          <MetricCard label="Payroll Net" value={formatIDRShort(totalNet)} sub={currentPayroll ? currentPayroll.status : 'Belum dihitung'} accent="#5b5ef0" />
          <MetricCard label="Outstanding" value={formatIDRShort(totalOutstanding)} sub={`${outstanding.length} klien`} accent="#f97316" />
        </div>

        {/* Client Overview */}
        <div style={{
          background: 'white', borderRadius: '16px', border: '1px solid #eaeef4',
          padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.04)'
        }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '14px', color: '#5a6478', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Client Overview
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {db.companies?.map((c: any) => {
              const empOfClient = db.employees.filter((e: any) => e.company === c.name).length;
              const projOfClient = db.projects.filter((p: any) => p.company === c.name).length;
              return (
                <div key={c.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 14px', background: '#f7f8fb', borderRadius: '12px'
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{c.name}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                      {empOfClient} emp · {projOfClient} project · {c.payrollType}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px',
                    background: 'rgba(16,185,129,0.12)', color: '#059669'
                  }}>ACTIVE</span>
                </div>
              );
            })}
          </div>
        </div>

        <p style={{ marginTop: '28px', fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>
          ProQPay Lite · Next.js 16 · Data loaded from localStorage ·{' '}
          <a href="https://github.com/ImHeroesKiller/proqpay-lite" style={{ color: '#5b5ef0' }}>GitHub</a>
        </p>
      </div>
    </main>
  );
}

function MetricCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{
      background: 'white', borderRadius: '16px', border: '1px solid #eaeef4',
      padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
      position: 'relative', overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px',
        background: accent, opacity: 0.7
      }} />
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#5a6478', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: '4px' }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{sub}</div>
    </div>
  );
}
