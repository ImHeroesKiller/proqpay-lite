export type ApiMonitorSummary = {
  connectedApps: number;
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
};

export type ApiEndpointEvent = {
  app_id: string;
  app_name: string;
  event_type: 'CONNECTION' | 'DATA_PULL' | 'REQUEST';
  method: string;
  endpoint: string;
  status_code: number;
  duration_ms: number;
  created_at: string;
};

export type ApiEndpointStat = {
  endpoint: string;
  request_count: number;
  data_pull_count: number;
  error_count: number;
  last_seen_at: string;
};

export type IntegrationMonitorResponse = {
  ok: boolean;
  pendingMigration?: boolean;
  baseEndpoint: string;
  monitorHeaders?: { appId:string; appName:string };
  summary: ApiMonitorSummary;
  apps: ApiConnectedApp[];
  events: ApiEndpointEvent[];
  endpoints: ApiEndpointStat[];
};

export async function getIntegrationMonitor() {
  const response = await fetch('/api/integration-monitor', {
    headers:{ Accept:'application/json' },
    cache:'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || 'Monitoring endpoint gagal dimuat');
  return data as IntegrationMonitorResponse;
}
