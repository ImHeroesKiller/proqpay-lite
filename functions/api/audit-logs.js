import { d1All, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'GET, OPTIONS';
const OPS = new Set(['SUPER_ADMIN']);
const SOURCES = new Set(['BUSINESS','PAYROLL','PAYMENT','BILLING','EMPLOYEE_SERVICE','SECURITY','INTEGRATION','SYSTEM']);
const LEVELS = new Set(['INFO','SUCCESS','WARN','ERROR']);

function orgId(env, actor) {
  return String(env.DEFAULT_ORG_ID || actor?.orgId || 'ORG-OTSINDO');
}

function pageMeta(offset, limit, total, rows) {
  return {
    offset,
    limit,
    total,
    hasMore: offset + rows.length < total,
    nextOffset: offset + rows.length,
  };
}

function unifiedSql() {
  return `
    WITH unified AS (
      SELECT
        id,
        timestamp,
        CASE
          WHEN action LIKE 'EWA_%' OR action LIKE 'EMPLOYEE_PORTAL_%' OR entity IN ('ewa_request','employee_credentials') THEN 'EMPLOYEE_SERVICE'
          WHEN action LIKE '%PAYMENT%' OR action LIKE '%RECONCIL%' OR action LIKE '%PI_%' OR entity IN ('payment_instruction','payment_proof','reconciliation') THEN 'PAYMENT'
          WHEN action LIKE '%INVOICE%' OR action LIKE '%BILLING%' OR action LIKE '%AR_%' OR entity IN ('invoice','ar_monitor','ar_payment') THEN 'BILLING'
          WHEN action LIKE '%PAYROLL%' OR action LIKE '%SUBMISSION%' OR action LIKE '%PAY_RUN%' OR entity IN ('payroll_submission','payroll_run') THEN 'PAYROLL'
          WHEN action LIKE '%LOGIN%' OR action LIKE '%PASSWORD%' OR action LIKE '%CREDENTIAL%' THEN 'SECURITY'
          WHEN action LIKE '%INTEGRATION%' OR action LIKE '%GATEWAY%' OR action LIKE '%API_%' THEN 'INTEGRATION'
          ELSE 'BUSINESS'
        END AS source,
        CASE
          WHEN action LIKE '%FAILED%' OR action LIKE '%ERROR%' OR action LIKE '%FAILURE%' THEN 'ERROR'
          WHEN action LIKE '%REJECT%' OR action LIKE '%CANCEL%' OR action LIKE '%WARN%' OR action LIKE '%BLOCK%' THEN 'WARN'
          WHEN action LIKE '%APPROVED%' OR action LIKE '%COMPLETED%' OR action LIKE '%SUCCESS%' OR action LIKE '%DISBURSED%' OR action LIKE '%REPAID%' OR action LIKE '%ISSUED%' OR action LIKE '%PAID%' OR action LIKE '%MATCHED%' THEN 'SUCCESS'
          ELSE 'INFO'
        END AS level,
        action AS event,
        COALESCE(detail,'') AS message,
        COALESCE(username,'SYSTEM') AS actor,
        COALESCE(role,'SYSTEM') AS actor_role,
        entity,
        entity_id,
        NULL AS ip,
        'AUDIT_LOG' AS origin
      FROM audit_logs
      WHERE org_id=?

      UNION ALL

      SELECT
        a.id,
        a.created_at AS timestamp,
        'EMPLOYEE_SERVICE' AS source,
        CASE WHEN a.success=1 THEN 'SUCCESS' ELSE 'WARN' END AS level,
        CASE WHEN a.success=1 THEN 'EMPLOYEE_PORTAL_LOGIN_SUCCESS' ELSE 'EMPLOYEE_PORTAL_LOGIN_FAILED' END AS event,
        CASE
          WHEN a.success=1 THEN 'Login Employee Portal berhasil'
          ELSE 'Login Employee Portal gagal' || CASE WHEN COALESCE(a.reason,'')<>'' THEN ': ' || a.reason ELSE '' END
        END AS message,
        COALESCE(e.name,a.employee_id_input,'EMPLOYEE') AS actor,
        'EMPLOYEE' AS actor_role,
        'employee' AS entity,
        COALESCE(a.employee_id,a.employee_id_input) AS entity_id,
        a.ip,
        'PORTAL_LOGIN' AS origin
      FROM portal_login_attempts a
      LEFT JOIN employees e ON e.id=a.employee_id
      WHERE a.org_id=?

      UNION ALL

      SELECT
        ev.id,
        ev.created_at AS timestamp,
        'INTEGRATION' AS source,
        CASE
          WHEN ev.status_code>=500 THEN 'ERROR'
          WHEN ev.status_code>=400 THEN 'WARN'
          WHEN ev.status_code>=200 AND ev.status_code<400 THEN 'SUCCESS'
          ELSE 'INFO'
        END AS level,
        'API_' || ev.event_type AS event,
        ev.method || ' ' || ev.endpoint || ' · HTTP ' || ev.status_code || ' · ' || ev.duration_ms || 'ms' AS message,
        ev.app_name AS actor,
        'EXTERNAL_APP' AS actor_role,
        'api_endpoint' AS entity,
        ev.app_id AS entity_id,
        NULL AS ip,
        'API_ENDPOINT_EVENT' AS origin
      FROM api_endpoint_events ev
      WHERE ev.org_id=?

      UNION ALL

      SELECT
        ge.id,
        ge.received_at AS timestamp,
        'PAYMENT' AS source,
        CASE
          WHEN ge.status='FAILED' OR ge.signature_valid=0 THEN 'ERROR'
          WHEN ge.status='PROCESSED' THEN 'SUCCESS'
          WHEN ge.status='IGNORED' THEN 'WARN'
          ELSE 'INFO'
        END AS level,
        'GATEWAY_' || ge.event_type AS event,
        ge.provider || ' · ' || ge.status || CASE WHEN ge.signature_valid=1 THEN ' · signature valid' ELSE ' · signature invalid' END AS message,
        ge.provider AS actor,
        'PAYMENT_PROVIDER' AS actor_role,
        'payment_gateway_transaction' AS entity,
        ge.payment_gateway_transaction_id AS entity_id,
        NULL AS ip,
        'GATEWAY_EVENT' AS origin
      FROM payment_gateway_events ge
      JOIN payment_gateway_transactions gt ON gt.id=ge.payment_gateway_transaction_id
      WHERE gt.org_id=?
    )
  `;
}

function buildFilters({ q, source, level, from, to }) {
  const clauses = [];
  const bindings = [];
  if (q) {
    clauses.push("(lower(COALESCE(event,'')) LIKE ? OR lower(COALESCE(message,'')) LIKE ? OR lower(COALESCE(actor,'')) LIKE ? OR lower(COALESCE(entity,'')) LIKE ? OR lower(COALESCE(entity_id,'')) LIKE ? OR lower(COALESCE(ip,'')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    bindings.push(like, like, like, like, like, like);
  }
  if (source) { clauses.push('source=?'); bindings.push(source); }
  if (level) { clauses.push('level=?'); bindings.push(level); }
  if (from) { clauses.push('timestamp>=?'); bindings.push(from + 'T00:00:00'); }
  if (to) { clauses.push('timestamp<?'); bindings.push(to + 'T23:59:59.999'); }
  return {
    sql: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '',
    bindings,
  };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);

  const authorization = await authorize(request, env, {
    roles: [...OPS],
    mutating: false,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;

  const limited = await enforceRateLimit(request, env, authorization.actor, 'audit-logs', METHODS);
  if (limited) return limited;

  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);

  const params = new URL(request.url).searchParams;
  const q = String(params.get('q') || '').trim().slice(0, 120);
  const rawSource = String(params.get('source') || '').trim().toUpperCase();
  const rawLevel = String(params.get('level') || '').trim().toUpperCase();
  const source = SOURCES.has(rawSource) ? rawSource : '';
  const level = LEVELS.has(rawLevel) ? rawLevel : '';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(params.get('from') || '')) ? String(params.get('from')) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(params.get('to') || '')) ? String(params.get('to')) : '';
  const offset = Math.max(0, Number.parseInt(params.get('offset') || '0', 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(params.get('limit') || '50', 10) || 50));

  const organizationId = orgId(env, authorization.actor);
  const filter = buildFilters({ q, source, level, from, to });
  const cte = unifiedSql();
  const baseBindings = [organizationId, organizationId, organizationId, organizationId];

  try {
    const rows = await d1All(
      env.DB,
      `${cte}
       SELECT id,timestamp,source,level,event,message,actor,actor_role,entity,entity_id,ip,origin
       FROM unified
       ${filter.sql}
       ORDER BY timestamp DESC,id DESC
       LIMIT ? OFFSET ?`,
      [...baseBindings, ...filter.bindings, limit, offset],
    );

    const count = await d1First(
      env.DB,
      `${cte}
       SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN level='ERROR' THEN 1 ELSE 0 END) AS errors,
         SUM(CASE WHEN level='WARN' THEN 1 ELSE 0 END) AS warnings,
         SUM(CASE WHEN source='EMPLOYEE_SERVICE' THEN 1 ELSE 0 END) AS employee_services,
         SUM(CASE WHEN event='EMPLOYEE_PORTAL_LOGIN_FAILED' THEN 1 ELSE 0 END) AS failed_logins
       FROM unified
       ${filter.sql}`,
      [...baseBindings, ...filter.bindings],
    );

    const sourceRows = await d1All(
      env.DB,
      `${cte}
       SELECT source,COUNT(*) AS total
       FROM unified
       GROUP BY source
       ORDER BY total DESC,source ASC`,
      baseBindings,
    );

    const health = await d1First(
      env.DB,
      `SELECT
        (SELECT COUNT(*) FROM payment_gateway_transactions WHERE org_id=? AND status='FAILED') AS gateway_failed,
        (SELECT COUNT(*) FROM payment_gateway_transactions WHERE org_id=? AND status IN ('CREATED','PENDING','PROCESSING')) AS gateway_active,
        (SELECT COUNT(*) FROM api_connected_apps WHERE org_id=? AND status IN ('OBSERVED','ACTIVE')) AS connected_apps,
        (SELECT COUNT(*) FROM api_endpoint_events WHERE org_id=? AND status_code>=400 AND created_at>=datetime('now','-24 hours')) AS api_errors_24h`,
      [organizationId,organizationId,organizationId,organizationId],
    );

    return respond({
      ok: true,
      rows,
      page: pageMeta(offset, limit, Number(count?.total || 0), rows),
      summary: {
        total: Number(count?.total || 0),
        errors: Number(count?.errors || 0),
        warnings: Number(count?.warnings || 0),
        employeeServices: Number(count?.employee_services || 0),
        failedLogins: Number(count?.failed_logins || 0),
      },
      sources: sourceRows.map((row) => ({ source: row.source, total: Number(row.total || 0) })),
      health: {
        gatewayFailed: Number(health?.gateway_failed || 0),
        gatewayActive: Number(health?.gateway_active || 0),
        connectedApps: Number(health?.connected_apps || 0),
        apiErrors24h: Number(health?.api_errors_24h || 0),
      },
      filters: { q, source, level, from, to },
      authority: 'D1',
    });
  } catch (error) {
    return respond({ error: 'Audit logs failed', ...publicError(error, crypto.randomUUID()) }, 500);
  }
}
