'use client';

import { useEffect, useState } from 'react';
import { loadDatabase, saveDatabase } from '@/lib/database';
import { onDbChange } from '@/lib/events';
import { loadSettings, onSettingsChange, type AppSettings } from '@/lib/app-settings';
import Sidebar, { type AppView } from '@/components/Sidebar';
import AppHeader from '@/components/AppHeader';
import HelpModal from '@/components/HelpModal';
import IdaFab from '@/components/IdaFab';
import SystemLogs from '@/components/SystemLogs';
import OperatingWorkspace from '@/components/OperatingWorkspace';
import PayrollControlTower from '@/components/PayrollControlTower';
import DirectoryManager from '@/components/DirectoryManager';
import ReportsWorkspace from '@/components/ReportsWorkspace';
import SystemHealthBubble from '@/components/SystemHealthBubble';
import EmployeeDirectory from '@/components/EmployeeDirectory';
import { writeSystemLog } from '@/lib/system-log';
import { syncDatabaseFromNeon } from '@/lib/neon-sync';
import { ChangePasswordModal, LoginScreen } from '@/components/AuthViews';

type Actor = { id: string; name?: string; email: string; role: string; permissions: string[]; mustChangePassword?: boolean; clientIds?: string[] | null; projectIds?: string[] | null; authMode?: string };

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

  if (mounted && authChecked && authRequired) return <LoginScreen />;

  if (!mounted || !db || !settings || !authChecked || !actor) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <p style={{ color: 'var(--text3)', fontSize: 13 }}>Memuat…</p>
      </div>
    );
  }

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
              <PayrollControlTower actor={actor} period={period} onPeriodChange={handlePeriodChange} onNavigate={navigate} />
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

            {view === 'operations' && <OperatingWorkspace />}

            {view === 'reports' && <ReportsWorkspace />}
          </div>
        </div>
      </div>
      {actor.mustChangePassword && ['database', 'session'].includes(actor.authMode || '') ? <ChangePasswordModal forced /> : null}

      <SystemHealthBubble />
      <IdaFab openSignal={idaOpenSignal} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
