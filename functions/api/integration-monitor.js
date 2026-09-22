import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1All, d1First, hasD1 } from './_d1.js';

const METHODS = 'GET, OPTIONS';
const ROLES = ['SUPER_ADMIN'];

function orgId(env) {
  return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return secureJson({ error:'Method not allowed' }, 405, request, env, METHODS);

  const authorization = await authorize(request, env, { roles:ROLES, methods:METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'integration-monitor', METHODS);
  if (limited) return limited;
  if (!hasD1(env)) return secureJson({ error:'Cloudflare D1 binding unavailable', code:'D1_REQUIRED' }, 503, request, env, METHODS);

  const organizationId = orgId(env);
  try {
    const [summary, apps, events, endpoints] = await Promise.all([
      d1First(env.DB, `SELECT
          (SELECT COUNT(*) FROM api_connected_apps WHERE org_id=?) AS connected_apps,
          COUNT(*) AS requests_24h,
          COALESCE(SUM(CASE WHEN event_type='DATA_PULL' THEN 1 ELSE 0 END),0) AS data_pulls_24h,
          COALESCE(SUM(CASE WHEN status_code>=400 THEN 1 ELSE 0 END),0) AS errors_24h,
          MAX(created_at) AS last_activity_at
        FROM api_endpoint_events
        WHERE org_id=? AND created_at>=datetime('now','-24 hours')`,
        [organizationId, organizationId]),
      d1All(env.DB, `SELECT app_id,app_name,status,first_seen_at,last_seen_at,last_endpoint,last_status_code,
          request_count,data_pull_count,error_count
        FROM api_connected_apps WHERE org_id=? ORDER BY last_seen_at DESC LIMIT 50`,
        [organizationId]),
      d1All(env.DB, `SELECT app_id,app_name,event_type,method,endpoint,status_code,duration_ms,created_at
        FROM api_endpoint_events WHERE org_id=? ORDER BY created_at DESC LIMIT 80`,
        [organizationId]),
      d1All(env.DB, `SELECT endpoint,
          COUNT(*) AS request_count,
          SUM(CASE WHEN event_type='DATA_PULL' THEN 1 ELSE 0 END) AS data_pull_count,
          SUM(CASE WHEN status_code>=400 THEN 1 ELSE 0 END) AS error_count,
          MAX(created_at) AS last_seen_at
        FROM api_endpoint_events
        WHERE org_id=? AND created_at>=datetime('now','-24 hours')
        GROUP BY endpoint
        ORDER BY request_count DESC,last_seen_at DESC LIMIT 40`,
        [organizationId]),
    ]);

    return secureJson({
      ok:true,
      baseEndpoint:new URL('/api', request.url).toString().replace(/\/$/, ''),
      monitorHeaders:{
        appId:'X-ProQPay-App-Id',
        appName:'X-ProQPay-App-Name',
      },
      summary:{
        connectedApps:Number(summary?.connected_apps || 0),
        requests24h:Number(summary?.requests_24h || 0),
        dataPulls24h:Number(summary?.data_pulls_24h || 0),
        errors24h:Number(summary?.errors_24h || 0),
        lastActivityAt:summary?.last_activity_at || null,
      },
      apps,
      events,
      endpoints,
    }, 200, request, env, METHODS);
  } catch (error) {
    if (/no such table: api_(connected_apps|endpoint_events)/i.test(String(error?.message || error))) {
      return secureJson({
        ok:true,
        pendingMigration:true,
        baseEndpoint:new URL('/api', request.url).toString().replace(/\/$/, ''),
        summary:{ connectedApps:0,requests24h:0,dataPulls24h:0,errors24h:0,lastActivityAt:null },
        apps:[],
        events:[],
        endpoints:[],
      }, 200, request, env, METHODS);
    }
    const requestId = crypto.randomUUID();
    return secureJson(publicError(error, requestId), 500, request, env, METHODS);
  }
}
