import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1All, d1Batch, d1First, d1Run, hasD1 } from './_d1.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN'];
const APP_ACTIONS = new Map([
  ['ACTIVATE','ACTIVE'],
  ['DEACTIVATE','INACTIVE'],
  ['REVOKE','REVOKED'],
]);
const APP_STATUSES = new Set(['OBSERVED','ACTIVE','INACTIVE','REVOKED']);
const EVENT_TYPES = new Set(['CONNECTION','DATA_PULL','REQUEST']);

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

function intParam(params, key, fallback, min, max) {
  const parsed = Number.parseInt(String(params.get(key) || ''), 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function dateParam(params, key) {
  const value = clean(params.get(key), 30);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
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

function healthState(summary) {
  const requests = Number(summary?.requests_24h || 0);
  const errors = Number(summary?.errors_24h || 0);
  const last = summary?.last_activity_at ? new Date(summary.last_activity_at).getTime() : 0;
  const ageMinutes = last ? Math.max(0, (Date.now() - last) / 60000) : Infinity;
  const errorRate = requests > 0 ? errors / requests : 0;
  if (!requests && !last) return { state:'IDLE', reason:'Belum ada traffic aplikasi eksternal', errorRate:0 };
  if (errorRate >= 0.2 || (requests > 0 && ageMinutes > 180)) {
    return { state:'DOWN', reason:errorRate >= 0.2 ? 'Error rate 24 jam >= 20%' : 'Tidak ada aktivitas lebih dari 3 jam', errorRate };
  }
  if (errorRate >= 0.05 || errors >= 5) {
    return { state:'DEGRADED', reason:'Error rate atau jumlah error perlu perhatian', errorRate };
  }
  return { state:'HEALTHY', reason:'Traffic dan error rate dalam kondisi normal', errorRate };
}

function buildEventFilter(params, organizationId) {
  const q = clean(params.get('q'), 120).toLowerCase();
  const appId = clean(params.get('appId'), 120);
  const endpoint = clean(params.get('endpoint'), 220);
  const eventTypeRaw = clean(params.get('eventType'), 40).toUpperCase();
  const statusClass = clean(params.get('statusClass'), 20).toUpperCase();
  const from = dateParam(params, 'from');
  const to = dateParam(params, 'to');
  const clauses = ['org_id=?'];
  const bindings = [organizationId];

  if (q) {
    const like = `%${q}%`;
    clauses.push("(lower(app_name) LIKE ? OR lower(app_id) LIKE ? OR lower(endpoint) LIKE ? OR lower(COALESCE(correlation_id,'')) LIKE ?)");
    bindings.push(like, like, like, like);
  }
  if (appId) { clauses.push('app_id=?'); bindings.push(appId); }
  if (endpoint) { clauses.push('endpoint=?'); bindings.push(endpoint); }
  if (EVENT_TYPES.has(eventTypeRaw)) { clauses.push('event_type=?'); bindings.push(eventTypeRaw); }
  if (statusClass === 'ERROR') clauses.push('status_code>=400');
  if (statusClass === 'SUCCESS') clauses.push('status_code>=200 AND status_code<400');
  if (from) { clauses.push("created_at>=?"); bindings.push(from + 'T00:00:00'); }
  if (to) { clauses.push("created_at<=?"); bindings.push(to + 'T23:59:59.999'); }

  return {
    sql:clauses.join(' AND '),
    bindings,
    values:{ q, appId, endpoint, eventType:EVENT_TYPES.has(eventTypeRaw) ? eventTypeRaw : '', statusClass, from, to },
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

    const params = new URL(request.url).searchParams;
    const days = retentionDays(env);
    const eventOffset = intParam(params, 'eventOffset', 0, 0, 1_000_000);
    const eventLimit = intParam(params, 'eventLimit', 25, 10, 100);
    const appOffset = intParam(params, 'appOffset', 0, 0, 1_000_000);
    const appLimit = intParam(params, 'appLimit', 20, 10, 100);
    const appStatusRaw = clean(params.get('appStatus'), 20).toUpperCase();
    const appStatus = APP_STATUSES.has(appStatusRaw) ? appStatusRaw : '';
    const eventFilter = buildEventFilter(params, organizationId);

    await d1Run(env.DB,
      `DELETE FROM api_endpoint_events WHERE org_id=? AND created_at<datetime('now',?)`,
      [organizationId, '-' + days + ' days']);

    const appWhere = ['org_id=?'];
    const appBindings = [organizationId];
    if (eventFilter.values.q) {
      const appLike = `%${eventFilter.values.q}%`;
      appWhere.push("(lower(app_name) LIKE ? OR lower(app_id) LIKE ? OR lower(COALESCE(last_endpoint,'')) LIKE ?)");
      appBindings.push(appLike, appLike, appLike);
    }
    if (appStatus) { appWhere.push('status=?'); appBindings.push(appStatus); }

    const [summary, apps, appCount, events, eventCount, endpoints] = await Promise.all([
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
        FROM api_connected_apps
        WHERE ${appWhere.join(' AND ')}
        ORDER BY last_seen_at DESC
        LIMIT ? OFFSET ?`,
        [...appBindings, appLimit, appOffset]),
      d1First(env.DB, `SELECT COUNT(*) AS total FROM api_connected_apps WHERE ${appWhere.join(' AND ')}`, appBindings),
      d1All(env.DB, `SELECT app_id,app_name,event_type,method,endpoint,status_code,duration_ms,correlation_id,created_at
        FROM api_endpoint_events
        WHERE ${eventFilter.sql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
        [...eventFilter.bindings, eventLimit, eventOffset]),
      d1First(env.DB, `SELECT COUNT(*) AS total FROM api_endpoint_events WHERE ${eventFilter.sql}`, eventFilter.bindings),
      d1All(env.DB, `SELECT endpoint,
          COUNT(*) AS request_count,
          SUM(CASE WHEN event_type='DATA_PULL' THEN 1 ELSE 0 END) AS data_pull_count,
          SUM(CASE WHEN status_code>=400 THEN 1 ELSE 0 END) AS error_count,
          AVG(duration_ms) AS avg_duration_ms,
          MAX(duration_ms) AS max_duration_ms,
          MAX(created_at) AS last_seen_at
        FROM api_endpoint_events
        WHERE org_id=? AND created_at>=datetime('now','-24 hours')
        GROUP BY endpoint
        ORDER BY error_count DESC,request_count DESC,last_seen_at DESC LIMIT 50`,
        [organizationId]),
    ]);

    const health = healthState(summary);
    return secureJson({
      ok:true,
      baseEndpoint:new URL('/api', request.url).toString().replace(/\/$/, ''),
      monitorHeaders:{
        appId:'X-ProQPay-App-Id',
        appName:'X-ProQPay-App-Name',
      },
      retentionDays:days,
      health,
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
      appPage:{
        offset:appOffset,
        limit:appLimit,
        total:Number(appCount?.total || 0),
        hasMore:appOffset + apps.length < Number(appCount?.total || 0),
      },
      events,
      eventPage:{
        offset:eventOffset,
        limit:eventLimit,
        total:Number(eventCount?.total || 0),
        hasMore:eventOffset + events.length < Number(eventCount?.total || 0),
      },
      filters:{ ...eventFilter.values, appStatus },
      endpoints:endpoints.map((row) => ({
        ...row,
        avg_duration_ms:Math.round(Number(row.avg_duration_ms || 0)),
        max_duration_ms:Number(row.max_duration_ms || 0),
      })),
      diagnostics:{
        errorRate24h:health.errorRate,
        slowEndpoints:endpoints.filter((row) => Number(row.avg_duration_ms || 0) >= 1000).length,
        failingEndpoints:endpoints.filter((row) => Number(row.error_count || 0) > 0).length,
      },
      correlationId,
    }, 200, request, env, METHODS);
  } catch (error) {
    if (/no such table: api_(connected_apps|endpoint_events)|no such column: correlation_id|no such column: status_updated/i.test(String(error?.message || error))) {
      return secureJson({
        ok:true,
        pendingMigration:true,
        baseEndpoint:new URL('/api', request.url).toString().replace(/\/$/, ''),
        retentionDays:retentionDays(env),
        health:{ state:'IDLE',reason:'Migration observability belum aktif',errorRate:0 },
        summary:{ connectedApps:0,trustedApps:0,observedApps:0,requests24h:0,dataPulls24h:0,errors24h:0,lastActivityAt:null },
        apps:[],
        appPage:{ offset:0,limit:20,total:0,hasMore:false },
        events:[],
        eventPage:{ offset:0,limit:25,total:0,hasMore:false },
        endpoints:[],
        diagnostics:{ errorRate24h:0,slowEndpoints:0,failingEndpoints:0 },
        correlationId,
      }, 200, request, env, METHODS);
    }
    return secureJson(publicError(error, correlationId), 500, request, env, METHODS);
  }
}
