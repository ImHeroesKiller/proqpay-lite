'use client';

import { useEffect, useState } from 'react';
import { loadDatabase, saveDatabase } from '@/lib/database';
import { formatIDR, formatIDRShort } from '@/lib/format';
import { onDbChange } from '@/lib/events';
import { loadSettings, onSettingsChange, type AppSettings } from '@/lib/app-settings';
import Sidebar, { type AppView } from '@/components/Sidebar';
import AppHeader from '@/components/AppHeader';
import HelpModal from '@/components/HelpModal';
import IdaFab from '@/components/IdaFab';
import MetricCard from '@/components/MetricCard';
import ClientDetail from '@/components/ClientDetail';
import RegionMap from '@/components/RegionMap';
import MetricPopup from '@/components/MetricPopup';
import DashFilters from '@/components/DashFilters';
import SystemLogs from '@/components/SystemLogs';
import { IconUsers, IconBuilding, IconWallet, IconClock } from '@/components/Icons';

type PopupType = 'employees' | 'clients' | 'payroll' | 'outstanding' | null;

export default function Home() {
  const [db, setDb] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [popup, setPopup] = useState<PopupType>(null);
  const [period, setPeriod] = useState('2025-07');
  const [view, setView] = useState<AppView>('dashboard');
  const [helpOpen, setHelpOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [idaOpenSignal, setIdaOpenSignal] = useState(0);

  useEffect(() => {
    setMounted(true);
    const data = loadDatabase();
    setDb(data);
    const st = loadSettings();
    setSettings(st);
    if (data?.meta?.currentPeriod) setPeriod(data.meta.currentPeriod);
    else if (st.defaultPeriod) setPeriod(st.defaultPeriod);

    const unsub = onDbChange(() => {
      const fresh = loadDatabase();
      setDb(fresh);
      if (fresh?.meta?.currentPeriod) setPeriod(fresh.meta.currentPeriod);
    });
    const unsubS = onSettingsChange(() => setSettings(loadSettings()));
    return () => {
      unsub();
      unsubS();
    };
  }, []);

  function handlePeriodChange(p: string) {
    setPeriod(p);
    if (!db) return;
    const next = { ...db, meta: { ...db.meta, currentPeriod: p } };
    saveDatabase(next);
    setDb(next);
  }

  if (!mounted || !db || !settings) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <p style={{ color: 'var(--text3)', fontSize: 13 }}>Memuat…</p>
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

  const pad = settings.density === 'compact' ? '18px 16px' : '28px 24px';

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        view={view}
        onView={setView}
        onOpenIda={() => setIdaOpenSignal((n) => n + 1)}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <AppHeader period={period} onHelp={() => setHelpOpen(true)} />

        <div style={{ flex: 1, overflowY: 'auto', padding: pad }}>
          <div style={{ maxWidth: 1180, margin: '0 auto' }}>
            {view === 'dashboard' && (
              <section>
                <h2 style={{ fontSize: 22, fontWeight: 720, marginBottom: 4 }}>Ringkasan</h2>
                <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
                  Periode {period}
                </p>

                <DashFilters period={period} onPeriodChange={handlePeriodChange} />

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 14,
                    marginBottom: 20,
                  }}
                >
                  <MetricCard
                    label="Karyawan"
                    value={String(empCount)}
                    sub={`${clientCount} klien`}
                    accent="#06b6d4"
                    icon={<IconUsers />}
                    sparkData={undefined}
                    onClick={() => setPopup('employees')}
                  />
                  <MetricCard
                    label="Klien"
                    value={String(clientCount)}
                    sub={`${projectCount} proyek`}
                    accent="#14b8a6"
                    icon={<IconBuilding />}
                    sparkData={undefined}
                    onClick={() => setPopup('clients')}
                  />
                  <MetricCard
                    label="Payroll"
                    value={formatIDRShort(totalNet)}
                    sub={currentPayroll ? currentPayroll.status : 'Belum dihitung'}
                    accent="#5b5ef0"
                    icon={<IconWallet />}
                    sparkData={settings.showSparklines && payrollTrend.length > 1 ? payrollTrend : undefined}
                    onClick={() => setPopup('payroll')}
                  />
                  <MetricCard
                    label="Piutang"
                    value={formatIDRShort(totalOutstanding)}
                    sub={`${outstanding.length} tagihan`}
                    accent="#f97316"
                    icon={<IconClock />}
                    sparkData={undefined}
                    onClick={() => setPopup('outstanding')}
                  />
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    gap: 16,
                  }}
                >
                  {settings.showMap && <RegionMap employees={db.employees} />}

                  <div className="card" style={{ padding: 20 }}>
                    <h3
                      style={{
                        fontSize: 11,
                        fontWeight: 650,
                        marginBottom: 14,
                        color: 'var(--text2)',
                        textTransform: 'uppercase',
                      }}
                    >
                      Klien
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {db.companies?.map((c: any) => {
                        const empOfClient = db.employees.filter((e: any) => e.company === c.name).length;
                        return (
                          <div
                            key={c.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '12px 14px',
                              background: 'var(--bg-subtle)',
                              borderRadius: 'var(--r-md)',
                              border: '1px solid var(--border-soft)',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 650, fontSize: 14 }}>{c.name}</div>
                              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                                {empOfClient} karyawan
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 650,
                                padding: '3px 10px',
                                borderRadius: 999,
                                background: 'rgba(16,185,129,0.12)',
                                color: '#059669',
                              }}
                            >
                              Aktif
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {settings.showClientDetail && clientCount > 0 && <ClientDetail db={db} />}
              </section>
            )}

            {view === 'employees' && (
              <section>
                <h2 style={{ fontSize: 22, fontWeight: 720 }}>Karyawan</h2>
                <p style={{ color: 'var(--text3)', fontSize: 13 }}>{empCount} data</p>
                <div className="card" style={{ marginTop: 16, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['ID', 'Nama', 'Klien', 'Wilayah', 'Gaji'].map((h) => (
                          <th key={h} style={th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(db.employees || []).map((e: any) => (
                        <tr key={e.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                          <td style={td}>{e.id}</td>
                          <td style={td}>{e.name}</td>
                          <td style={td}>{e.company}</td>
                          <td style={td}>{e.region || e.province || '-'}</td>
                          <td style={td}>{formatIDR(e.salaryGross || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {view === 'clients' && (
              <section>
                <h2 style={{ fontSize: 22, fontWeight: 720 }}>Klien</h2>
                <div className="card" style={{ marginTop: 16, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['ID', 'Nama', 'PIC', 'Telepon', 'Tipe'].map((h) => (
                          <th key={h} style={th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(db.companies || []).map((c: any) => (
                        <tr key={c.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                          <td style={td}>{c.id}</td>
                          <td style={td}>{c.name}</td>
                          <td style={td}>{c.pic || '-'}</td>
                          <td style={td}>{c.phone || '-'}</td>
                          <td style={td}>{c.payrollType || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {view === 'logs' && <SystemLogs auditLogs={db.auditLogs || []} />}

            {view === 'reports' && (
              <section>
                <h2 style={{ fontSize: 22, fontWeight: 720 }}>Laporan</h2>
                <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
                  <div className="card" style={{ padding: 20 }}>
                    <h3 style={{ marginTop: 0, fontSize: 15 }}>Payroll</h3>
                    {(db.payrolls || []).length === 0 && <p style={{ color: 'var(--text3)' }}>Belum ada data.</p>}
                    {(db.payrolls || []).map((p: any) => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                        <span>
                          {p.period} · {p.status}
                        </span>
                        <strong>{formatIDR(p.summary?.totalNet || 0)}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="card" style={{ padding: 20 }}>
                    <h3 style={{ marginTop: 0, fontSize: 15 }}>Piutang</h3>
                    {outstanding.length === 0 && <p style={{ color: 'var(--text3)' }}>Tidak ada piutang.</p>}
                    {outstanding.map((a: any) => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                        <span>
                          {a.company} · {a.invoiceId}
                        </span>
                        <strong>{formatIDR(a.amount)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      <IdaFab openSignal={idaOpenSignal} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      {popup && <MetricPopup type={popup} db={db} onClose={() => setPopup(null)} />}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  background: 'var(--bg-subtle)',
  color: 'var(--text2)',
  fontSize: 11,
  textTransform: 'uppercase',
};
const td: React.CSSProperties = { padding: '10px 14px' };
