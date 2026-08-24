import { d1All, d1First, d1Run, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'GET, POST, OPTIONS';
const OPS = new Set(['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER']);

function orgId(env, actor) {
  return String(env.DEFAULT_ORG_ID || actor?.orgId || 'ORG-OTSINDO');
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }
  const authorization = await authorize(request, env, {
    roles: [...OPS],
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'ewa', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);

  const actor = authorization.actor;
  const organizationId = orgId(env, actor);

  try {
    if (request.method === 'GET') {
      const status = new URL(request.url).searchParams.get('status') || '';
      const rows = await d1All(
        env.DB,
        `SELECT r.*, e.name AS employee_name, e.employee_code, c.name AS client_name
         FROM ewa_requests r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN clients c ON c.id=r.client_id
         WHERE r.org_id=?
           AND (?='' OR r.status=?)
         ORDER BY r.created_at DESC
         LIMIT 100`,
        [organizationId, status, status],
      );
      const pending = rows.filter((row) => row.status === 'SUBMITTED').length;
      return respond({ ok: true, pending, requests: rows });
    }

    let body;
    try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
    const action = String(body.action || '').toUpperCase();
    const requestId = String(body.id || body.requestId || '').trim();
    if (!requestId) return respond({ error: 'id wajib' }, 422);
    const current = await d1First(env.DB, 'SELECT * FROM ewa_requests WHERE id=? AND org_id=? LIMIT 1', [requestId, organizationId]);
    if (!current) return respond({ error: 'Pengajuan tidak ditemukan' }, 404);

    let nextStatus = '';
    if (action === 'APPROVE' && current.status === 'SUBMITTED') nextStatus = 'APPROVED';
    else if (action === 'REJECT' && current.status === 'SUBMITTED') nextStatus = 'REJECTED';
    else if (action === 'DISBURSE' && current.status === 'APPROVED') nextStatus = 'DISBURSED';
    else if (action === 'REPAY' && current.status === 'DISBURSED') nextStatus = 'REPAID';
    else return respond({ error: 'Aksi tidak valid untuk status saat ini' }, 409);

    const note = String(body.note || '').slice(0, 240);
    await d1Run(
      env.DB,
      `UPDATE ewa_requests SET status=?, decision_note=?, decided_by=?, decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      [nextStatus, note || null, actor.email || actor.id, requestId],
    );
    await d1Run(
      env.DB,
      `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
        VALUES (?, ?, ?, ?, ?, ?, 'ewa_request', ?)`,
      [
        `AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role,
        `EWA_${nextStatus}`, `${requestId} · ${current.employee_id}`, requestId,
      ],
    );
    const updated = await d1First(env.DB, 'SELECT * FROM ewa_requests WHERE id=?', [requestId]);
    return respond({ ok: true, request: updated });
  } catch (error) {
    return respond({ error: 'EWA request failed', ...publicError(error, crypto.randomUUID()) }, 500);
  }
}
