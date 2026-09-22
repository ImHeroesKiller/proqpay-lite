function clean(value, max = 180) {
  return String(value || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

function appIdentity(request) {
  const appId = clean(
    request.headers.get('X-ProQPay-App-Id')
      || request.headers.get('Cf-Access-Client-Id')
      || '',
    120,
  );
  if (!appId) return null;
  const appName = clean(request.headers.get('X-ProQPay-App-Name') || appId, 160);
  return { appId, appName };
}

function eventType(request, response) {
  const path = new URL(request.url).pathname;
  const success = response.status >= 200 && response.status < 300;
  if (request.method === 'GET' && success && !['/api/health','/api/me','/api/integration-monitor'].includes(path)) {
    return 'DATA_PULL';
  }
  if (['/api/health','/api/me'].includes(path)) return 'CONNECTION';
  return 'REQUEST';
}

async function persist(database, env, request, response, startedAt, identity) {
  const organizationId = String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
  const endpoint = clean(new URL(request.url).pathname, 220);
  const userAgent = clean(request.headers.get('User-Agent') || '', 220);
  const type = eventType(request, response);
  const durationMs = Math.max(0, Date.now() - startedAt);
  const isPull = type === 'DATA_PULL' ? 1 : 0;
  const isError = response.status >= 400 ? 1 : 0;

  await database.batch([
    database.prepare(`INSERT INTO api_connected_apps
      (id,org_id,app_id,app_name,status,first_seen_at,last_seen_at,last_endpoint,last_status_code,request_count,data_pull_count,error_count,user_agent)
      VALUES(?,?,?,?, 'OBSERVED',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?,1,?,?,?)
      ON CONFLICT(org_id,app_id) DO UPDATE SET
        app_name=excluded.app_name,
        last_seen_at=excluded.last_seen_at,
        last_endpoint=excluded.last_endpoint,
        last_status_code=excluded.last_status_code,
        request_count=api_connected_apps.request_count+1,
        data_pull_count=api_connected_apps.data_pull_count+excluded.data_pull_count,
        error_count=api_connected_apps.error_count+excluded.error_count,
        user_agent=excluded.user_agent`)
      .bind(
        'APIAPP-' + crypto.randomUUID(),
        organizationId,
        identity.appId,
        identity.appName,
        endpoint,
        response.status,
        isPull,
        isError,
        userAgent || null,
      ),
    database.prepare(`INSERT INTO api_endpoint_events
      (id,org_id,app_id,app_name,event_type,method,endpoint,status_code,duration_ms,user_agent)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        'APIEVT-' + crypto.randomUUID(),
        organizationId,
        identity.appId,
        identity.appName,
        type,
        request.method,
        endpoint,
        response.status,
        durationMs,
        userAgent || null,
      ),
  ]);
}

export async function onRequest(context) {
  const startedAt = Date.now();
  const identity = appIdentity(context.request);
  const response = await context.next();

  // Monitoring headers are metadata only: they do not grant access and do not
  // bypass normal ProQPay authentication. The underlying endpoint stays authoritative.
  if (identity && context.env?.DB?.prepare && context.env?.DB?.batch) {
    const task = persist(context.env.DB, context.env, context.request, response, startedAt, identity)
      .catch((error) => console.error(JSON.stringify({
        level:'warn',
        source:'api-monitor',
        message:error instanceof Error ? error.message : String(error),
      })));
    if (typeof context.waitUntil === 'function') context.waitUntil(task);
    else await task;
  }

  return response;
}
