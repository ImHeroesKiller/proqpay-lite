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
import DashFilters from '@/components/DashFilters';
import SystemLogs from '@/components/SystemLogs';
import OperatingWorkspace from '@/components/OperatingWorkspace';
import RoleDashboard from '@/components/RoleDashboard';
import DirectoryManager from '@/components/DirectoryManager';
import EmployeeDirectory from '@/components/EmployeeDirectory';
import WorkforceInsights from '@/components/WorkforceInsights';
import ClientPortfolio from '@/components/ClientPortfolio';
import { IconUsers, IconBuilding, IconWallet, IconClock } from '@/components/Icons';
import { writeSystemLog } from '@/lib/system-log';
import { syncDatabaseFromNeon } from '@/lib/neon-sync';
import { ChangePasswordModal, LoginScreen } from '@/components/AuthViews';

type Actor = { id: string; name?: string; email: string; role: string; permissions: string[]; mustChangePassword?: boolean; clientIds?: string[] | null; authMode?: string };

export default function Home() {
  const [db, setDb] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [period, setPeriod] = useState('2025-07');
  const [view, setView] = useState<AppView>('dashboard');
  const [helpOpen, setHelpOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [idaOpenSignal, setIdaOpenSignal] = useState(0);
  const [actor, setActor] = useState<Actor | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [employeeRegionFilter, setEmployeeRegionFilter] = useState('ALL');

  useEffect(() => {
    const controller = new AbortController();
    setMounted(true);
    writeSystemLog('INFO', 'APP', 'APPLICATION_STARTED', 'ProQPay Lite dashboard dimuat');
    const data = loadDatabase();
    setDb(data);
    void fetch('/api/me', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) { setAuthRequired(true); return; }
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        const authenticatedActor = { ...(result.user || {}), authMode: result.authMode || 'origin' };
        setActor(authenticatedActor);
        setAuthRequired(false);
        const { db: canonical } = await syncDatabaseFromNeon(data, { signal: controller.signal });
        saveDatabase(canonical);
        setDb(canonical);
        if (canonical?.meta?.currentPeriod) setPeriod(canonical.meta.currentPeriod);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') writeSystemLog('WARN', 'SECURITY', 'USER_CONTEXT_FAILED', 'Gagal memuat role pengguna');
      })
      .finally(() => setAuthChecked(true));
    const st = loadSettings();
    setSettings(st);
    const requestedView = new URLSearchParams(window.location.search).get('view');
    const allowedViews: AppView[] = ['dashboard', 'operations', 'employees', 'clients', 'reports', 'logs'];
    setView(allowedViews.includes(requestedView as AppView) ? requestedView as AppView : st.defaultView);
    if (data?.meta?.currentPeriod) setPeriod(data.meta.currentPeriod);
    else if (st.defaultPeriod) setPeriod(st.defaultPeriod);

    const unsub = onDbChange(() => {
      const fresh = loadDatabase();
      setDb(fresh);
      if (fresh?.meta?.currentPeriod) setPeriod(fresh.meta.currentPeriod);
    });
    const unsubS = onSettingsChange(() => setSettings(loadSettings()));
    return () => {
      controller.abort();
      unsub();
      unsubS();
    };
  }, []);

  useEffect(() => {
    const minutes = settings?.autoRefreshMinutes || 0;
    if (!minutes) return;
    const timer = window.setInterval(() => {
      const current = loadDatabase();
      void syncDatabaseFromNeon(current)
        .then(({ db: canonical }) => { saveDatabase(canonical); setDb(canonical); })
        .catch(() => writeSystemLog('WARN', 'DATABASE', 'AUTO_REFRESH_FAILED', 'Refresh otomatis gagal'));
    }, minutes * 60_000);
    return () => window.clearInterval(timer);
  }, [settings?.autoRefreshMinutes]);

  function handlePeriodChange(p: string) {
    writeSystemLog('INFO', 'DASHBOARD', 'PERIOD_CHANGED', `Periode aktif diubah ke ${p}`);
    setPeriod(p);
    if (!db) return;
    const next = { ...db, meta: { ...db.meta, currentPeriod: p } };
    saveDatabase(next);
    setDb(next);
  }

  async function refreshCanonical() {
    if (!db) return;
    const result = await syncDatabaseFromNeon(db, { requireData: true });
    saveDatabase(result.db);
    setDb(result.db);
  }

  function navigate(nextView: AppView) {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextView);
    window.history.replaceState({}, '', url);
  }

  function openEmployees(region = 'ALL') {
    setEmployeeRegionFilter(region);
    navigate('employees');
  }

  if (mounted && authChecked && authRequired) return <LoginScreen />;

  if (!mounted || !db || !settings || !authChecked || !actor) {
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
    <div className={`app-shell theme-${settings.theme} accent-${settings.accentColor} density-${settings.density}${settings.enableAnimations ? '' : ' animations-off'}`} style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        view={view}
        onView={navigate}
        onOpenIda={() => setIdaOpenSignal((n) => n + 1)}
        role={actor?.role}
        compact={settings.sidebarMode === 'compact'}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <AppHeader period={period} onHelp={() => setHelpOpen(true)} actor={actor} />

        <div style={{ flex: 1, overflowY: 'auto', padding: pad }}>
          <div key={view} className="app-view-transition" style={{ maxWidth: 1180, margin: '0 auto' }}>
            {view === 'dashboard' && (
              <section className="dashboard-page">
                <div className="page-heading dashboard-heading">
                  <div>
                    <span className="page-eyebrow">Operational command center</span>
                    <h1>Ringkasan bisnis</h1>
                    <p>Data payroll, tenaga kerja, dan kesiapan operasional dalam satu tampilan.</p>
                  </div>
                  <DashFilters period={period} onPeriodChange={handlePeriodChange} />
                </div>

                {settings.showKpis ? <div className="dashboard-metrics">
                  <MetricCard
                    label="Karyawan"
                    value={String(empCount)}
                    sub={`${clientCount} klien`}
                    accent="#06b6d4"
                    icon={<IconUsers />}
                    sparkData={undefined}
                    onClick={() => openEmployees()}
                  />
                  <MetricCard
                    label="Klien"
                    value={String(clientCount)}
                    sub={`${projectCount} proyek`}
                    accent="#14b8a6"
                    icon={<IconBuilding />}
                    sparkData={undefined}
                    onClick={() => navigate('clients')}
                  />
                  <MetricCard
                    label="Payroll"
                    value={formatIDRShort(totalNet)}
                    sub={currentPayroll ? currentPayroll.status : 'Belum dihitung'}
                    accent="#5b5ef0"
                    icon={<IconWallet />}
                    sparkData={settings.showSparklines && payrollTrend.length > 1 ? payrollTrend : undefined}
                    onClick={() => navigate('operations')}
                  />
                  <MetricCard
                    label="Piutang"
                    value={formatIDRShort(totalOutstanding)}
                    sub={`${outstanding.length} tagihan`}
                    accent="#f97316"
                    icon={<IconClock />}
                    sparkData={undefined}
                    onClick={() => navigate('reports')}
                  />
                </div> : null}

                <div className="dashboard-primary-grid">
                  {settings.showWorkforceInsights ? <WorkforceInsights employees={db.employees || []} onOpenEmployees={openEmployees} showDataSourceBadge={settings.showDataSourceBadges} /> : null}
                  <RoleDashboard actor={actor} onNavigate={navigate} />
                </div>

                <div className="dashboard-secondary-grid">
                  {settings.showMap ? <RegionMap employees={db.employees} pageSize={settings.dashboardPageSize} onOpenEmployees={openEmployees} /> : null}
                  {settings.showClientPortfolio ? <ClientPortfolio companies={db.companies || []} employees={db.employees || []} projects={db.projects || []} pageSize={settings.dashboardPageSize} onOpenDirectory={() => navigate('clients')} /> : null}
                </div>

                {settings.showClientDetail && clientCount > 0 ? <ClientDetail db={db} pageSize={settings.dashboardPageSize} onOpenEmployees={openEmployees} /> : null}
              </section>
            )}

            {view === 'employees' && (
              <EmployeeDirectory employees={db.employees || []} actor={actor} pageSize={settings.employeePageSize} initialRegion={employeeRegionFilter} maskSensitiveData={settings.maskSensitiveData} />
            )}

            {view === 'clients' && (
              <DirectoryManager
                actor={actor}
                onChanged={refreshCanonical}
                existingClients={db.companies || []}
                existingProjects={db.projects || []}
              />
            )}

            {view === 'logs' && <SystemLogs auditLogs={db.auditLogs || []} />}

            {view === 'operations' && <OperatingWorkspace />}

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
      {actor.mustChangePassword && ['database', 'session'].includes(actor.authMode || '') ? <ChangePasswordModal forced /> : null}

      <IdaFab openSignal={idaOpenSignal} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
