export type HealthState = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'IDLE';

export type ApiMonitorSummary = {
  connectedApps: number;
  trustedApps?: number;
  observedApps?: number;
  requests24h: number;
  dataPulls24h: number;
  errors24h: number;
  lastActivityAt?: string | null;
};

export type ApiConnectedApp = {
  app_id: string;
  app_name: string;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  last_endpoint?: string | null;
  last_status_code?: number | null;
  request_count: number;
  data_pull_count: number;
  error_count: number;
  status_updated_by?: string | null;
  status_updated_at?: string | null;
};

export type ApiEndpointEvent = {
  app_id: string;
  app_name: string;
  event_type: 'CONNECTION' | 'DATA_PULL' | 'REQUEST';
  method: string;
  endpoint: string;
  status_code: number;
  duration_ms: number;
  correlation_id?: string | null;
  created_at: string;
};

export type ApiEndpointStat = {
  endpoint: string;
  request_count: number;
  data_pull_count: number;
  error_count: number;
  avg_duration_ms?: number;
  max_duration_ms?: number;
  last_seen_at: string;
};

export type PageMeta = {
  offset:number;
  limit:number;
  total:number;
  hasMore:boolean;
};

export type MonitorFilters = {
  q?:string;
  appId?:string;
  endpoint?:string;
  eventType?:string;
  statusClass?:string;
  appStatus?:string;
  from?:string;
  to?:string;
  eventOffset?:number;
  eventLimit?:number;
  appOffset?:number;
  appLimit?:number;
};

export type IntegrationMonitorResponse = {
  ok: boolean;
  pendingMigration?: boolean;
  baseEndpoint: string;
  retentionDays?: number;
  correlationId?: string;
  monitorHeaders?: { appId:string; appName:string };
  health?: { state:HealthState; reason:string; errorRate:number };
  summary: ApiMonitorSummary;
  apps: ApiConnectedApp[];
  appPage?: PageMeta;
  events: ApiEndpointEvent[];
  eventPage?: PageMeta;
  filters?: MonitorFilters;
  endpoints: ApiEndpointStat[];
  diagnostics?: {
    errorRate24h:number;
    slowEndpoints:number;
    failingEndpoints:number;
  };
};

function toQuery(filters: MonitorFilters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key, String(value));
  });
  return params.toString();
}

export async function getIntegrationMonitor(filters: MonitorFilters = {}, signal?: AbortSignal) {
  const query = toQuery(filters);
  const response = await fetch('/api/integration-monitor' + (query ? '?' + query : ''), {
    headers:{ Accept:'application/json' },
    cache:'no-store',
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || 'Monitoring endpoint gagal dimuat');
  return data as IntegrationMonitorResponse;
}

export async function updateIntegrationAppStatus(appId: string, action: 'ACTIVATE' | 'DEACTIVATE' | 'REVOKE') {
  const response = await fetch('/api/integration-monitor', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ appId, action }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || 'Status aplikasi gagal diubah');
  return data as { ok:true; appId:string; previousStatus:string; status:string; correlationId?:string };
}
