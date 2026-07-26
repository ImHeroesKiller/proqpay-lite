'use client';

import { useEffect, useState } from 'react';
import { loadDatabase, saveDatabase } from '@/lib/database';
import { formatIDRShort } from '@/lib/format';
import { onDbChange } from '@/lib/events';
import Sidebar from '@/components/Sidebar';
import IdaFab from '@/components/IdaFab';
import MetricCard from '@/components/MetricCard';
import ClientDetail from '@/components/ClientDetail';
import RegionMap from '@/components/RegionMap';
import MetricPopup from '@/components/MetricPopup';
import DashFilters from '@/components/DashFilters';
import ExcelUpload from '@/components/ExcelUpload';
import { IconUsers, IconBuilding, IconWallet, IconClock } from '@/components/Icons';

type PopupType = 'employees' | 'clients' | 'payroll' | 'outstanding' | null;

export default function Home() {
  const [db, setDb] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [popup, setPopup] = useState<PopupType>(null);
  const [period, setPeriod] = useState('2025-07');

  useEffect(() => {
    setMounted(true);
    const data = loadDatabase();
    setDb(data);
    if (data?.meta?.currentPeriod) setPeriod(data.meta.currentPeriod);

    const unsub = onDbChange(() => {
      const fresh = loadDatabase();
      setDb(fresh);
      if (fresh?.meta?.currentPeriod) setPeriod(fresh.meta.currentPeriod);
    });
    return unsub;
  }, []);

  function handlePeriodChange(p: string) {
    setPeriod(p);
    if (!db) return;
    const next = { ...db, meta: { ...db.meta, currentPeriod: p } };
    saveDatabase(next);
    setDb(next);
  }

  if (!mounted || !db) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '12px', margin: '0 auto 12px',
            background: 'linear-gradient(135deg, var(--accent), var(--violet))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: '13px',
          }}>PQ</div>
          <p style={{ color: 'var(--text3)', fontSize: '13px' }}>Loading ProQPay Lite…</p>
        </div>
      </div>
    );
  }

  const empCount = db.employees?.length || 0;
  const clientCount = db.companies?.length || 0;
  const projectCount = db.projects?.length || 0;
  const currentPayroll = db.payrolls?.find((p: any) => p.period === period);
  const totalNet = currentPayroll?.summary?.totalNet || 0;
  const outstanding = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
  const totalOutstanding = outstanding.reduce((s: number, a: any) => s + a.amount, 0);

  const payrollTrend = (db.payrolls || [])
    .slice()
    .sort((a: any, b: any) => a.period.localeCompare(b.period))
    .map((p: any) => p.summary?.totalNet || 0);
  if (payrollTrend.length < 2) {
    payrollTrend.push(...[82000000, 88000000, 91000000, totalNet || 94000000]);
  }
  const empTrend = [8, 9, 10, 11, empCount];
  const clientTrend = [1, 1, 2, 2, clientCount];
  const arTrend = [120000000, 110000000, 100000000, totalOutstanding || 107800000];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{
          height: '58px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', background: 'rgba(255,255,255,0.82)', borderBottom: '1px solid var(--border)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', position: 'sticky', top: 0, zIndex: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontWeight: 720, fontSize: '16px', letterSpacing: '-0.03em' }}>
              ProQPay <span style={{ color: 'var(--orange)' }}>Lite</span>
            </div>
            <span style={{
              fontSize: '10.5px', fontWeight: 650, color: 'var(--accent)',
              padding: '4px 10px', border: '1px solid var(--accent-soft2)',
              background: 'var(--accent-soft)', borderRadius: 'var(--r-pill)', letterSpacing: '0.02em'
            }}>AI Payroll OS</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '12px', padding: '5px 12px', borderRadius: 'var(--r-pill)',
              background: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text2)', fontWeight: 550
            }}>{period}</span>
            <span style={{
              fontSize: '12px', padding: '5px 12px', borderRadius: 'var(--r-pill)',
              background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 650
            }}>Super Admin</span>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px' }}>
          <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
            <section>
              <h2 style={{ fontSize: '22px', fontWeight: 720, marginBottom: '4px', letterSpacing: '-0.03em' }}>
                Global Snapshot
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '16px' }}>
                All Clients · {period} · klik card untuk detail
              </p>

              <DashFilters period={period} onPeriodChange={handlePeriodChange} />

              <ExcelUpload />

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '14px', marginBottom: '20px'
              }}>
                <MetricCard
                  label="Employees"
                  value={String(empCount)}
                  sub={`${clientCount} client · ${projectCount} project`}
                  accent="#06b6d4"
                  icon={<IconUsers />}
                  sparkData={empTrend}
                  onClick={() => setPopup('employees')}
                />
                <MetricCard
                  label="Clients"
                  value={String(clientCount)}
                  sub={`${projectCount} project aktif`}
                  accent="#14b8a6"
                  icon={<IconBuilding />}
                  sparkData={clientTrend}
                  onClick={() => setPopup('clients')}
                />
                <MetricCard
                  label="Payroll Net"
                  value={formatIDRShort(totalNet)}
                  sub={currentPayroll ? currentPayroll.status : 'Belum dihitung'}
                  accent="#5b5ef0"
                  icon={<IconWallet />}
                  sparkData={payrollTrend}
                  onClick={() => setPopup('payroll')}
                />
                <MetricCard
                  label="Outstanding"
                  value={formatIDRShort(totalOutstanding)}
                  sub={`${outstanding.length} klien`}
                  accent="#f97316"
                  icon={<IconClock />}
                  sparkData={arTrend}
                  onClick={() => setPopup('outstanding')}
                />
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '16px',
                marginBottom: '8px'
              }}>
                <RegionMap employees={db.employees} />

                <div className="card" style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '11px', fontWeight: 650, marginBottom: '14px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Client Overview
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {db.companies?.map((c: any) => {
                      const empOfClient = db.employees.filter((e: any) => e.company === c.name).length;
                      const projOfClient = db.projects.filter((p: any) => p.company === c.name).length;
                      return (
                        <div key={c.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)',
                          border: '1px solid var(--border-soft)',
                        }}>
                          <div>
                            <div style={{ fontWeight: 650, fontSize: '14px' }}>{c.name}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                              {empOfClient} emp · {projOfClient} project · {c.payrollType}
                            </div>
                          </div>
                          <span style={{
                            fontSize: '10.5px', fontWeight: 650, padding: '3px 10px', borderRadius: 'var(--r-pill)',
                            background: 'rgba(16,185,129,0.12)', color: '#059669'
                          }}>ACTIVE</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <ClientDetail db={db} />

            <p style={{ marginTop: '28px', fontSize: '12px', color: 'var(--text3)', textAlign: 'center' }}>
              ProQPay Lite · Next.js 16 ·{' '}
              <a href="https://proqpay-lite.pages.dev/">Cloudflare Pages</a>
              {' · '}
              <a href="https://github.com/ImHeroesKiller/proqpay-lite">GitHub</a>
            </p>
          </div>
        </div>
      </div>

      <IdaFab />

      {popup && (
        <MetricPopup type={popup} db={db} onClose={() => setPopup(null)} />
      )}
    </div>
  );
}
