'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import AppWorkspaceRouter from '@/components/AppWorkspaceRouter';
import { useVisibilityAwareCanonicalRefresh } from '@/hooks/useVisibilityAwareCanonicalRefresh';
import { roleCanAction } from '../../shared/authority-matrix.js';
import { loadDatabase, saveDatabase, setDatabaseActor, clearDatabaseMirror, databaseActorScope } from '@/lib/database';
import { onDbChange } from '@/lib/events';
import { loadSettings, onSettingsChange, type AppSettings } from '@/lib/app-settings';
import Sidebar, { allowedViewsForRole, type AppView } from '@/components/Sidebar';
import AppHeader from '@/components/AppHeader';
import SystemHealthBubble from '@/components/SystemHealthBubble';
import { writeSystemLog, clearSystemLogs } from '@/lib/system-log';
import { syncDatabaseFromCloudflare } from '@/lib/cloudflare-sync';
import { clearIdaSessionId } from '@/lib/session';
import { listOperatingDashboard, listOperatingPeriods, setOperatingCacheActor } from '@/lib/operating-model-api';
import { ChangePasswordModal, LoginScreen } from '@/components/AuthViews';
import AppFooter from '@/components/AppFooter';
import {allowedPayrollView,normalizeInternalRoute,validAppView,PAYROLL_STAGE_URL,stageForView} from '@/lib/workspace-navigation';
import {patchRoute,routeParams,subscribeRoute} from '@/lib/route-state';
import {AUTHENTICATION_REQUIRED_EVENT} from '@/lib/api-client';

const IdaFab = dynamic(() => import('@/components/IdaFab'));
const HelpModal = dynamic(() => import('@/components/HelpModal'));

type Actor = { id: string; orgId?:string|null; name?: string; email: string; role: string; permissions: string[]; mustChangePassword?: boolean; clientIds?: string[] | null; projectIds?: string[] | null; authMode?: string };

function normalizeViewForRole(role:string, view:AppView):AppView {
  if ((view as string) === 'portalAudit') return 'logs';
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

  useEffect(()=>{
    const requireLogin=()=>{
      setActor(null);
      setAuthRequired(true);
      setAuthChecked(true);
      setOperatingCacheActor(null);
      clearDatabaseMirror();
      clearIdaSessionId();
      clearSystemLogs();
      setDb(null);
      setCanonicalPeriods([]);
      setCanonicalClientCount(null);
      setSettingsOpen(false);
      setMobileNavOpen(false);
    };
    window.addEventListener(AUTHENTICATION_REQUIRED_EVENT,requireLogin);
    return ()=>window.removeEventListener(AUTHENTICATION_REQUIRED_EVENT,requireLogin);
  },[]);

  useEffect(() => {
    const controller = new AbortController();
    setMounted(true);
    writeSystemLog('INFO', 'APP', 'APPLICATION_STARTED', 'ProQPay dashboard dimuat');
    const data = loadDatabase();
    const st = loadSettings();
    const params = new URLSearchParams(window.location.search);
    const requestedView = validAppView(params.get('view'));
    const requestedPeriod = params.get('period');
    setDb(data);
    setSettings(st);
    void fetch('/api/me?probe=1', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (result.authenticated === false && !result.user) {
          setAuthRequired(true);
          setActor(null);
          setOperatingCacheActor(null);
          clearDatabaseMirror();
          clearIdaSessionId();
          clearSystemLogs();
          setDb(null);
          return;
        }
        const authenticatedActor = { ...(result.user || {}), authMode: result.authMode || 'origin' };
        setDatabaseActor(authenticatedActor);
        const authenticatedScope=databaseActorScope();
        setActor(authenticatedActor);
        setOperatingCacheActor(authenticatedActor);
        const periodScopes:[string|undefined] = [undefined];
        void Promise.all(periodScopes.map((clientId:string|undefined)=>listOperatingPeriods(clientId)))
          .then((results)=>{
            if(databaseActorScope()!==authenticatedScope)return;
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
        const preferredView = normalizeViewForRole(authenticatedActor.role,requestedView||validAppView(st.defaultView)||'dashboard');
        const route=normalizeInternalRoute(preferredView,params.get('stage'),['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(authenticatedActor.role));
        const safeView=allowedViews.includes(route.view)?route.view:'dashboard';
        setView(safeView);
        const cleared=safeView==='dashboard'&&preferredView!=='dashboard'
          ?{recoveryClientId:null,recoveryAccountId:null,recoveryReturnView:null,fundingAccountId:null,recoveryComplete:null}:{};
        patchRoute({view:safeView,stage:safeView===route.view&&route.stage?PAYROLL_STAGE_URL[route.stage]:null,...cleared});
        setAuthRequired(false);
        setAuthChecked(true);
        void syncDatabaseFromCloudflare(data, { signal: controller.signal })
          .then(({ db: canonical }) => {
            if(saveDatabase(canonical,authenticatedScope))setDb(canonical);
          })
          .catch((error) => {
            if (error?.name !== 'AbortError') writeSystemLog('WARN', 'DATABASE', 'BACKGROUND_SYNC_FAILED', 'Sinkronisasi data latar belakang gagal');
          });
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          clearDatabaseMirror();
          clearIdaSessionId();
          clearSystemLogs();
          setOperatingCacheActor(null);
          setDb(null);
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
    void listOperatingDashboard(undefined, 'ALL')
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


  const updateCanonicalDatabase = useCallback((next:unknown) => setDb(next), []);
  useVisibilityAwareCanonicalRefresh(actor?settings?.autoRefreshMinutes || 0:0, updateCanonicalDatabase);

  function handlePeriodChange(p: string) {
    writeSystemLog('INFO', 'DASHBOARD', 'PERIOD_CHANGED', `Periode aktif diubah ke ${p}`);
    setPeriod(p);
    patchRoute({period:p});
    if (!db) return;
    const next = { ...db, meta: { ...db.meta, currentPeriod: p } };
    saveDatabase(next);
    setDb(next);
  }

  async function refreshCanonical() {
    if (!db) return;
    const scope=databaseActorScope();
    const result = await syncDatabaseFromCloudflare(db, { requireData: true });
    if(saveDatabase(result.db,scope))setDb(result.db);
  }

  function navigate(nextView: AppView) {
    const normalizedView = actor ? normalizeViewForRole(actor.role,nextView) : nextView;
    const safeView = actor && allowedViewsForRole(actor.role).includes(normalizedView) ? normalizedView : 'dashboard';
    setView(safeView);
    patchRoute({view:safeView,period,
      stage:['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(actor?.role||'')&&allowedPayrollView(safeView)?PAYROLL_STAGE_URL[stageForView(safeView)]:null,
      ...safeView!=='clients'?{recoveryClientId:null,recoveryAccountId:null,recoveryReturnView:null}:{},
      ...safeView!=='payments'?{fundingAccountId:null,recoveryComplete:null,paymentPanel:null}:{},
      ...safeView!=='logs'?{auditCorrelation:null}:{},
    },'push',{view:safeView,period});
  }

  function openAuditCorrelation(correlationId:string) {
    if (!correlationId || !actor || !roleCanAction(actor.role,'audit.view')) return;
    setView('logs');
    patchRoute({view:'logs',period,auditCorrelation:correlationId,stage:null},'push',{view:'logs',period,auditCorrelation:correlationId});
  }

  useEffect(() => {
    if (!actor) return;
    const onPopState = () => {
      const params = routeParams();
      const requestedView=validAppView(params.get('view'))||'dashboard';
      const normalizedView=normalizeViewForRole(actor.role,requestedView);
      const route=normalizeInternalRoute(normalizedView,params.get('stage'),['PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'].includes(actor.role));
      const safeView=allowedViewsForRole(actor.role).includes(route.view)?route.view:'dashboard';
      // Coerce disallowed stages/views into the canonical URL. The route
      // helper only dispatches an event when the URL actually changes.
      patchRoute({view:safeView,stage:safeView===route.view&&route.stage?PAYROLL_STAGE_URL[route.stage]:null,
        ...safeView==='dashboard'&&requestedView!=='dashboard'?{recoveryClientId:null,recoveryAccountId:null,recoveryReturnView:null,fundingAccountId:null,recoveryComplete:null}:{},
      });
      const requestedPeriod = params.get('period');
      setView(safeView);
      if (requestedPeriod) setPeriod(requestedPeriod);
      setSettingsOpen(false);
      setMobileNavOpen(false);
    };
    return subscribeRoute(onPopState);
  }, [actor]);

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
  const gatewayCanView = roleCanAction(actor.role,'payment.prepare') || roleCanAction(actor.role,'payment.approve');
  const gatewayCanExecute = roleCanAction(actor.role,'payment.execute');
  const integrationsCanManage = roleCanAction(actor.role,'integrations.manage');

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
        period={period}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <AppHeader period={period} periods={periods} view={view} clientCount={canonicalClientCount} onPeriodChange={handlePeriodChange} onNavigate={navigate} onHelp={() => setHelpOpen(true)} onMenu={() => setMobileNavOpen(true)} actor={actor} />

        <main style={{ flex: 1, overflowY: 'auto', padding: pad }}>
          <AppWorkspaceRouter
            view={view}
            actor={actor}
            period={period}
            db={db}
            settings={settings}
            gatewayCanView={gatewayCanView}
            gatewayCanExecute={gatewayCanExecute}
            integrationsCanManage={integrationsCanManage}
            onNavigate={navigate}
            onRefreshCanonical={refreshCanonical}
            onOpenAuditCorrelation={openAuditCorrelation}
          />
        </main>
        <AppFooter
          lastSyncAt={db.meta?.lastCloudflareSyncAt}
          onSupport={() => setHelpOpen(true)}
        />
      </div>
      {actor.mustChangePassword && ['database', 'session', 'd1'].includes(actor.authMode || '') ? <ChangePasswordModal forced /> : null}

      {roleCanAction(actor.role,'settings.manage') ? <SystemHealthBubble /> : null}
      {idaMounted ? <IdaFab openSignal={idaOpenSignal} /> : null}
      {helpOpen ? <HelpModal open onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}

