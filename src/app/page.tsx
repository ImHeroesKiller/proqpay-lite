'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { loadDatabase, saveDatabase } from '@/lib/database';
import { onDbChange } from '@/lib/events';
import { loadSettings, onSettingsChange, type AppSettings } from '@/lib/app-settings';
import Sidebar, { allowedViewsForRole, type AppView } from '@/components/Sidebar';
import AppHeader from '@/components/AppHeader';
import PayrollControlTower from '@/components/PayrollControlTower';
import RoleDashboard from '@/components/RoleDashboard';
import SystemHealthBubble from '@/components/SystemHealthBubble';
import { writeSystemLog } from '@/lib/system-log';
import { syncDatabaseFromCloudflare } from '@/lib/cloudflare-sync';
import { ChangePasswordModal, LoginScreen } from '@/components/AuthViews';

const OperatingWorkspace = dynamic(() => import('@/components/OperatingWorkspace'), { loading: () => <ViewLoading /> });
const EmployeeDirectory = dynamic(() => import('@/components/EmployeeDirectory'), { loading: () => <ViewLoading /> });
const DirectoryManager = dynamic(() => import('@/components/DirectoryManager'), { loading: () => <ViewLoading /> });
const ReportsWorkspace = dynamic(() => import('@/components/ReportsWorkspace'), { loading: () => <ViewLoading /> });
const SystemLogs = dynamic(() => import('@/components/SystemLogs'), { loading: () => <ViewLoading /> });
const EwaInbox = dynamic(() => import('@/components/EwaInbox'), { loading: () => <ViewLoading /> });
const IdaFab = dynamic(() => import('@/components/IdaFab'));
const HelpModal = dynamic(() => import('@/components/HelpModal'));

type Actor = { id: string; name?: string; email: string; role: string; permissions: string[]; mustChangePassword?: boolean; clientIds?: string[] | null; projectIds?: string[] | null; authMode?: string };

export default function Home() {
  const [db, setDb] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [period, setPeriod] = useState('2025-07');
  const [view, setView] = useState<AppView>('dashboard');
  const [helpOpen, setHelpOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [idaOpenSignal, setIdaOpenSignal] = useState(0);
  const [idaMounted, setIdaMounted] = useState(false);
  const [actor, setActor] = useState<Actor | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setMounted(true);
    writeSystemLog('INFO', 'APP', 'APPLICATION_STARTED', 'ProQPay Lite dashboard dimuat');
    const data = loadDatabase();
    const st = loadSettings();
    const requestedView = new URLSearchParams(window.location.search).get('view') as AppView | null;
    setDb(data);
    setSettings(st);
    void fetch('/api/me', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) { setAuthRequired(true); return; }
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        const authenticatedActor = { ...(result.user || {}), authMode: result.authMode || 'origin' };
        setActor(authenticatedActor);
        const allowedViews = allowedViewsForRole(authenticatedActor.role);
        const preferredView = requestedView || st.defaultView;
        setView(allowedViews.includes(preferredView as AppView) ? preferredView as AppView : 'dashboard');
        setAuthRequired(false);
        setAuthChecked(true);
        void syncDatabaseFromCloudflare(data, { signal: controller.signal })
          .then(({ db: canonical }) => {
            saveDatabase(canonical);
            setDb(canonical);
            if (canonical?.meta?.currentPeriod) setPeriod(canonical.meta.currentPeriod);
          })
          .catch((error) => {
            if (error?.name !== 'AbortError') writeSystemLog('WARN', 'DATABASE', 'BACKGROUND_SYNC_FAILED', 'Sinkronisasi data latar belakang gagal');
          });
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') writeSystemLog('WARN', 'SECURITY', 'USER_CONTEXT_FAILED', 'Gagal memuat role pengguna');
      })
      .finally(() => setAuthChecked(true));
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
      void syncDatabaseFromCloudflare(current)
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
    const result = await syncDatabaseFromCloudflare(db, { requireData: true });
    saveDatabase(result.db);
    setDb(result.db);
  }

  function navigate(nextView: AppView) {
    const safeView = actor && allowedViewsForRole(actor.role).includes(nextView) ? nextView : 'dashboard';
    setView(safeView);
    const url = new URL(window.location.href);
    url.searchParams.set('view', safeView);
    window.history.replaceState({}, '', url);
  }

  if (mounted && authChecked && authRequired) return <LoginScreen />;

  if (!mounted || !db || !settings || !authChecked || !actor) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <p style={{ color: 'var(--text3)', fontSize: 13 }}>Memuat…</p>
      </div>
    );
  }

  const pad = settings.density === 'compact' ? '18px 16px' : '28px 24px';
  const periods = [...new Set([period,...(db.payrolls || []).map((item:any)=>item.period).filter(Boolean)])].sort((a:string,b:string)=>b.localeCompare(a));

  return (
    <div className={`app-shell theme-${settings.theme} accent-${settings.accentColor} density-${settings.density}${settings.enableAnimations ? '' : ' animations-off'}`} style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        view={view}
        onView={navigate}
        onOpenIda={() => { setIdaMounted(true); setIdaOpenSignal((n) => n + 1); }}
        onOpenHelp={() => setHelpOpen(true)}
        role={actor?.role}
        compact={settings.sidebarMode === 'compact'}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        settingsOpen={settingsOpen}
        onSettingsOpen={setSettingsOpen}
        lastSyncAt={db.meta?.lastCloudflareSyncAt}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <AppHeader period={period} periods={periods} view={view} clientCount={(db.companies || []).length} onPeriodChange={handlePeriodChange} onNavigate={navigate} onHelp={() => setHelpOpen(true)} onMenu={() => setMobileNavOpen(true)} actor={actor} />

        <main style={{ flex: 1, overflowY: 'auto', padding: pad }}>
          <div key={view} className="app-view-transition" style={{ maxWidth: 1180, margin: '0 auto' }}>
            {view === 'dashboard' && (
              <><RoleDashboard actor={actor} onNavigate={navigate} /><PayrollControlTower actor={actor} period={period} onNavigate={navigate} /></>
            )}

            {view === 'employees' && (
              <EmployeeDirectory employees={db.employees || []} actor={actor} pageSize={settings.employeePageSize} initialRegion="ALL" maskSensitiveData={settings.maskSensitiveData} onChanged={refreshCanonical} />
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

            {view === 'operations' && <OperatingWorkspace mode="payruns" />}

            {view === 'exceptions' && <OperatingWorkspace mode="actions" />}

            {view === 'payments' && <OperatingWorkspace mode="payments" />}
            {view === 'billing' && <OperatingWorkspace mode="billing" />}
            {view === 'integrations' && <OperatingWorkspace mode="integrations" />}

            {view === 'ewa' && <EwaInbox />}

            {view === 'reports' && <ReportsWorkspace />}
          </div>
        </main>
      </div>
      {actor.mustChangePassword && ['database', 'session', 'd1'].includes(actor.authMode || '') ? <ChangePasswordModal forced /> : null}

      <SystemHealthBubble />
      {idaMounted ? <IdaFab openSignal={idaOpenSignal} /> : null}
      {helpOpen ? <HelpModal open onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}

function ViewLoading() {
  return <div className="card control-loading" role="status">Menyiapkan modul…</div>;
}
