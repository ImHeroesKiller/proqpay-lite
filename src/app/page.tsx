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
import { listOperatingDashboard, listOperatingPeriods } from '@/lib/operating-model-api';
import { ChangePasswordModal, LoginScreen } from '@/components/AuthViews';
import AppFooter from '@/components/AppFooter';

const OperatingWorkspace = dynamic(() => import('@/components/OperatingWorkspace'), { loading: () => <ViewLoading /> });
const EmployeeDirectory = dynamic(() => import('@/components/EmployeeDirectory'), { loading: () => <ViewLoading /> });
const DirectoryManager = dynamic(() => import('@/components/DirectoryManager'), { loading: () => <ViewLoading /> });
const ReportsWorkspace = dynamic(() => import('@/components/ReportsWorkspace'), { loading: () => <ViewLoading /> });
const ClientHome = dynamic(() => import('@/components/ClientHome'), { loading: () => <ViewLoading /> });
const ClientDocumentsWorkspace = dynamic(() => import('@/components/ClientDocumentsWorkspace'), { loading: () => <ViewLoading /> });
const SystemLogs = dynamic(() => import('@/components/SystemLogs'), { loading: () => <ViewLoading /> });
const EwaInbox = dynamic(() => import('@/components/EwaInbox'), { loading: () => <ViewLoading /> });
const PortalSettings = dynamic(() => import('@/components/PortalSettings'), { loading: () => <ViewLoading /> });
const PortalAudit = dynamic(() => import('@/components/PortalAudit'), { loading: () => <ViewLoading /> });
const IntegrationsWorkspace = dynamic(() => import('@/components/IntegrationsWorkspace'), { loading: () => <ViewLoading /> });
const PaymentGatewayPaymentPanel = dynamic(() => import('@/components/PaymentGatewayPaymentPanel'), { loading: () => <ViewLoading /> });
const IdaFab = dynamic(() => import('@/components/IdaFab'));
const HelpModal = dynamic(() => import('@/components/HelpModal'));

type Actor = { id: string; name?: string; email: string; role: string; permissions: string[]; mustChangePassword?: boolean; clientIds?: string[] | null; projectIds?: string[] | null; authMode?: string };

function normalizeViewForRole(role:string, view:AppView):AppView {
  if (role !== 'CLIENT_USER') return view;
  if (view === 'exceptions' || view === 'payments') return 'operations';
  if (view === 'billing') return 'reports';
  return view;
}

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
  const [initError, setInitError] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [canonicalPeriods, setCanonicalPeriods] = useState<string[]>([]);
  const [canonicalClientCount, setCanonicalClientCount] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setMounted(true);
    writeSystemLog('INFO', 'APP', 'APPLICATION_STARTED', 'ProQPay dashboard dimuat');
    const data = loadDatabase();
    const st = loadSettings();
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get('view') as AppView | null;
    const requestedPeriod = params.get('period');
    setDb(data);
    setSettings(st);
    void fetch('/api/me', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) { setAuthRequired(true); return; }
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        const authenticatedActor = { ...(result.user || {}), authMode: result.authMode || 'origin' };
        setActor(authenticatedActor);
        const periodScopes:[string|undefined] = [undefined];
        void Promise.all(periodScopes.map((clientId:string|undefined)=>listOperatingPeriods(clientId)))
          .then((results)=>{
            const merged=[...new Set(results.flatMap((result:any)=>Array.isArray(result.periods)?result.periods:[]))]
              .map(String).sort((a,b)=>b.localeCompare(a));
            setCanonicalPeriods(merged);
            const preferred=String(requestedPeriod || data?.meta?.currentPeriod || st.defaultPeriod || '');
            if (requestedPeriod && (merged.length === 0 || merged.includes(requestedPeriod))) {
              setPeriod(requestedPeriod);
            } else if(merged.length && !merged.includes(preferred)) {
              setPeriod(merged[0]);
            } else if (preferred) {
              setPeriod(preferred);
            }
          })
          .catch(()=>setCanonicalPeriods([]));
        const allowedViews = allowedViewsForRole(authenticatedActor.role);
        const preferredView = normalizeViewForRole(authenticatedActor.role, (requestedView || st.defaultView) as AppView);
        setView(allowedViews.includes(preferredView) ? preferredView : 'dashboard');
        setAuthRequired(false);
        setAuthChecked(true);
        void syncDatabaseFromCloudflare(data, { signal: controller.signal })
          .then(({ db: canonical }) => {
            saveDatabase(canonical);
            setDb(canonical);
          })
          .catch((error) => {
            if (error?.name !== 'AbortError') writeSystemLog('WARN', 'DATABASE', 'BACKGROUND_SYNC_FAILED', 'Sinkronisasi data latar belakang gagal');
          });
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setInitError(error instanceof Error ? error.message : 'Layanan aplikasi tidak dapat dijangkau');
          writeSystemLog('WARN', 'SECURITY', 'USER_CONTEXT_FAILED', 'Gagal memuat role pengguna');
        }
      })
      .finally(() => setAuthChecked(true));
    if (requestedPeriod) setPeriod(requestedPeriod);
    else if (data?.meta?.currentPeriod) setPeriod(data.meta.currentPeriod);
    else if (st.defaultPeriod) setPeriod(st.defaultPeriod);

    const unsub = onDbChange(() => {
      const fresh = loadDatabase();
      setDb(fresh);
      // The global period is owned by the canonical operating-model period
      // selector after boot. Background/local mirror changes must not override it.
    });
    const unsubS = onSettingsChange(() => setSettings(loadSettings()));
    return () => {
      controller.abort();
      unsub();
      unsubS();
    };
  }, []);

  useEffect(() => {
    if (!actor) return;
    if (actor.role === 'CLIENT_USER') {
      setCanonicalClientCount(actor.clientIds?.length ?? 0);
      return;
    }
    let cancelled = false;
    void listOperatingDashboard(undefined, period)
      .then((result) => {
        if (cancelled) return;
        const clients = Number(result.portfolioSummary?.clients);
        setCanonicalClientCount(Number.isFinite(clients) ? clients : null);
      })
      .catch(() => {
        if (!cancelled) setCanonicalClientCount(null);
      });
    return () => { cancelled = true; };
  }, [actor, period]);

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
    const url = new URL(window.location.href);
    url.searchParams.set('period', p);
    window.history.replaceState({}, '', url);
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
    const normalizedView = actor ? normalizeViewForRole(actor.role,nextView) : nextView;
    const safeView = actor && allowedViewsForRole(actor.role).includes(normalizedView) ? normalizedView : 'dashboard';
    setView(safeView);
    const url = new URL(window.location.href);
    url.searchParams.set('view', safeView);
    url.searchParams.set('period', period);
    window.history.replaceState({}, '', url);
  }

  if (mounted && authChecked && authRequired) return <LoginScreen />;

  if (mounted && authChecked && initError) {
    return (
      <main className="app-init-error">
        <section className="card" role="alert">
          <span>KONEKSI APLIKASI</span>
          <h1>ProQPay belum dapat dimuat</h1>
          <p>{initError}. Pastikan Cloudflare Pages Functions dan database lokal aktif, lalu coba kembali.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Coba lagi</button>
        </section>
      </main>
    );
  }

  if (!mounted || !db || !settings || !authChecked || !actor) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <p style={{ color: 'var(--text3)', fontSize: 13 }}>Memuat…</p>
      </div>
    );
  }

  const pad = settings.density === 'compact' ? '18px 16px' : '28px 24px';
  const periods = [...new Set([period,...(canonicalPeriods.length ? canonicalPeriods : (db.payrolls || []).map((item:any)=>item.period).filter(Boolean))])].sort((a:string,b:string)=>b.localeCompare(a));
  const gatewayCanView = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(actor.role);
  const gatewayCanExecute = ['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(actor.role);
  const simplifiedInternal = ['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(actor.role);

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
        period={period}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <AppHeader period={period} periods={periods} view={view} clientCount={canonicalClientCount} onPeriodChange={handlePeriodChange} onNavigate={navigate} onHelp={() => setHelpOpen(true)} onMenu={() => setMobileNavOpen(true)} actor={actor} />

        <main style={{ flex: 1, overflowY: 'auto', padding: pad }}>
          <div key={view} className="app-view-transition" style={{ maxWidth: 1180, margin: '0 auto' }}>
            {view === 'dashboard' && (
              actor.role === 'CLIENT_USER'
                ? <ClientHome actor={actor} period={period} onNavigate={navigate} />
                : <>{!simplifiedInternal ? <RoleDashboard actor={actor} onNavigate={navigate} /> : null}<PayrollControlTower actor={actor} period={period} onNavigate={navigate} /></>
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

            {view === 'payments' && <><OperatingWorkspace mode="payments" />{gatewayCanView ? <PaymentGatewayPaymentPanel role={actor.role} /> : null}</>}
            {view === 'billing' && <OperatingWorkspace mode="billing" />}
            {view === 'integrations' && <IntegrationsWorkspace canManage={gatewayCanExecute} canView={gatewayCanView} />}

            {view === 'ewa' && <EwaInbox />}
            {view === 'portalSettings' && <PortalSettings />}
            {view === 'portalAudit' && <PortalAudit />}

            {view === 'reports' && (actor.role === 'CLIENT_USER' ? <ClientDocumentsWorkspace actor={actor} /> : <ReportsWorkspace />)}
          </div>
        </main>
        <AppFooter
          lastSyncAt={db.meta?.lastCloudflareSyncAt}
          onSupport={() => setHelpOpen(true)}
        />
      </div>
      {actor.mustChangePassword && ['database', 'session', 'd1'].includes(actor.authMode || '') ? <ChangePasswordModal forced /> : null}

      {actor.role === 'SUPER_ADMIN' ? <SystemHealthBubble /> : null}
      {idaMounted ? <IdaFab openSignal={idaOpenSignal} /> : null}
      {helpOpen ? <HelpModal open onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}

function ViewLoading() {
  return <div className="card control-loading" role="status">Menyiapkan modul…</div>;
}