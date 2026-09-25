import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1All, d1Batch, d1First, d1Run, hasD1 } from './_d1.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN'];
const APP_ACTIONS = new Map([
  ['ACTIVATE','ACTIVE'],
  ['DEACTIVATE','INACTIVE'],
  ['REVOKE','REVOKED'],
]);

function orgId(env, actor) {
  return String(actor?.orgId || env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

function clean(value, max = 180) {
  return String(value ?? '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

function requestId(request) {
  return clean(request.headers.get('X-Request-Id') || request.headers.get('X-Correlation-Id') || crypto.randomUUID(), 120);
}

function retentionDays(env) {
  const raw = Number.parseInt(String(env.API_MONITOR_RETENTION_DAYS || '30'), 10);
  return Math.min(365, Math.max(1, Number.isFinite(raw) ? raw : 30));
}

function appAudit(organizationId, actor, action, appId, detail, correlationId) {
  return {
    statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,correlation_id)
      VALUES(?,?,?,?,?,?,?,?,?)`,
    bindings:[
      'AUD-' + crypto.randomUUID(),
      organizationId,
      actor.email,
      actor.role,
      action,
      detail,
      'api_connected_app',
      appId,
      correlationId,
    ],
  };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET','POST'].includes(request.method)) return secureJson({ error:'Method not allowed' }, 405, request, env, METHODS);

  const authorization = await authorize(request, env, {
    roles:ROLES,
    mutating:request.method === 'POST',
    methods:METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'integration-monitor', METHODS);
  if (limited) return limited;
  if (!hasD1(env)) return secureJson({ error:'Cloudflare D1 binding unavailable', code:'D1_REQUIRED' }, 503, request, env, METHODS);

  const organizationId = orgId(env, authorization.actor);
  const correlationId = requestId(request);

  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const action = clean(body.action, 40).toUpperCase();
      const nextStatus = APP_ACTIONS.get(action);
      const appId = clean(body.appId, 120);
      if (!nextStatus || !appId) {
        return secureJson({ error:'Action atau App ID tidak valid' }, 422, request, env, METHODS);
      }

      const current = await d1First(env.DB,
        'SELECT app_id,app_name,status FROM api_connected_apps WHERE org_id=? AND app_id=? LIMIT 1',
        [organizationId, appId]);
      if (!current) return secureJson({ error:'App belum pernah terobservasi', code:'APP_NOT_OBSERVED' }, 404, request, env, METHODS);
      if (current.status === 'REVOKED' && nextStatus !== 'REVOKED') {
        return secureJson({ error:'App yang sudah REVOKED tidak dapat diaktifkan kembali. Gunakan App ID baru.', code:'APP_REVOKED_TERMINAL' }, 409, request, env, METHODS);
      }

      await d1Batch(env.DB, [
        {
          statement:`UPDATE api_connected_apps
            SET status=?,status_updated_by=?,status_updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE org_id=? AND app_id=?`,
          bindings:[nextStatus, authorization.actor.email, organizationId, appId],
        },
        appAudit(
          organizationId,
          authorization.actor,
          'API_APP_' + nextStatus,
          appId,
          'app=' + clean(current.app_name, 120) + ' · from=' + current.status + ' · to=' + nextStatus,
          correlationId,
        ),
      ]);

      return secureJson({ ok:true, appId, previousStatus:current.status, status:nextStatus, correlationId }, 200, request, env, METHODS);
    }

    const days = retentionDays(env);
    await d1Run(env.DB,
      `DELETE FROM api_endpoint_events WHERE org_id=? AND created_at<datetime('now',?)`,
      [organizationId, '-' + days + ' days']);

    const [summary, apps, events, endpoints] = await Promise.all([
      d1First(env.DB, `SELECT
          (SELECT COUNT(*) FROM api_connected_apps WHERE org_id=? AND status='ACTIVE') AS trusted_apps,
          (SELECT COUNT(*) FROM api_connected_apps WHERE org_id=? AND status='OBSERVED') AS observed_apps,
          COUNT(*) AS requests_24h,
          COALESCE(SUM(CASE WHEN event_type='DATA_PULL' THEN 1 ELSE 0 END),0) AS data_pulls_24h,
          COALESCE(SUM(CASE WHEN status_code>=400 THEN 1 ELSE 0 END),0) AS errors_24h,
          MAX(created_at) AS last_activity_at
        FROM api_endpoint_events
        WHERE org_id=? AND created_at>=datetime('now','-24 hours')`,
        [organizationId, organizationId, organizationId]),
      d1All(env.DB, `SELECT app_id,app_name,status,first_seen_at,last_seen_at,last_endpoint,last_status_code,
          request_count,data_pull_count,error_count,status_updated_by,status_updated_at
        FROM api_connected_apps WHERE org_id=? ORDER BY last_seen_at DESC LIMIT 50`,
        [organizationId]),
      d1All(env.DB, `SELECT app_id,app_name,event_type,method,endpoint,status_code,duration_ms,correlation_id,created_at
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
      retentionDays:days,
      summary:{
        connectedApps:Number(summary?.trusted_apps || 0),
        trustedApps:Number(summary?.trusted_apps || 0),
        observedApps:Number(summary?.observed_apps || 0),
        requests24h:Number(summary?.requests_24h || 0),
        dataPulls24h:Number(summary?.data_pulls_24h || 0),
        errors24h:Number(summary?.errors_24h || 0),
        lastActivityAt:summary?.last_activity_at || null,
      },
      apps,
      events,
      endpoints,
      correlationId,
    }, 200, request, env, METHODS);
  } catch (error) {
    if (/no such table: api_(connected_apps|endpoint_events)|no such column: correlation_id|no such column: status_updated/i.test(String(error?.message || error))) {
      return secureJson({
        ok:true,
        pendingMigration:true,
        baseEndpoint:new URL('/api', request.url).toString().replace(/\/$/, ''),
        retentionDays:retentionDays(env),
        summary:{ connectedApps:0,trustedApps:0,observedApps:0,requests24h:0,dataPulls24h:0,errors24h:0,lastActivityAt:null },
        apps:[],
        events:[],
        endpoints:[],
        correlationId,
      }, 200, request, env, METHODS);
    }
    return secureJson(publicError(error, correlationId), 500, request, env, METHODS);
  }
}
