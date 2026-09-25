import { d1All, d1First, d1Run, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'GET, POST, OPTIONS';
const OPS = new Set(['SUPER_ADMIN']);

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
      const params = new URL(request.url).searchParams;
      const allowedStatuses = new Set(['SUBMITTED','APPROVED','DISBURSED','REPAYING','REPAID','REJECTED','CANCELLED']);
      const requestedStatus = String(params.get('status') || '').trim().toUpperCase();
      const status = requestedStatus && allowedStatuses.has(requestedStatus) ? requestedStatus : '';
      const clientId = String(params.get('clientId') || '').trim().slice(0, 80);
      const periodRaw = String(params.get('period') || '').trim();
      const period = /^\d{4}-\d{2}$/.test(periodRaw) ? periodRaw : '';
      const q = String(params.get('q') || '').trim().slice(0, 80);
      const offset = Math.max(0, Number.parseInt(params.get('offset') || '0', 10) || 0);
      const limit = Math.min(100, Math.max(1, Number.parseInt(params.get('limit') || '50', 10) || 50));
      const clauses = ['r.org_id=?'];
      const bindings = [organizationId];
      if (status) { clauses.push('r.status=?'); bindings.push(status); }
      if (clientId) { clauses.push('r.client_id=?'); bindings.push(clientId); }
      if (period) { clauses.push('r.period=?'); bindings.push(period); }
      if (q) {
        clauses.push('(lower(e.name) LIKE ? OR lower(e.employee_code) LIKE ? OR lower(r.id) LIKE ?)');
        const like = `%${q.toLowerCase()}%`;
        bindings.push(like, like, like);
      }
      const where = clauses.join(' AND ');
      const rows = await d1All(
        env.DB,
        `SELECT r.*, e.name AS employee_name, e.employee_code, c.name AS client_name
         FROM ewa_requests r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN clients c ON c.id=r.client_id
         WHERE ${where}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ? OFFSET ?`,
        [...bindings, limit, offset],
      );
      const filtered = await d1First(
        env.DB,
        `SELECT COUNT(*) AS total
          FROM ewa_requests r JOIN employees e ON e.id=r.employee_id
          WHERE ${where}`,
        bindings,
      );
      const summary = await d1First(
        env.DB,
        `SELECT
          SUM(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END) AS pending,
          COUNT(*) AS total
         FROM ewa_requests WHERE org_id=?`,
        [organizationId],
      );
      const statusRows = await d1All(
        env.DB,
        `SELECT status, COUNT(*) AS count
          FROM ewa_requests
          WHERE org_id=?
          GROUP BY status`,
        [organizationId],
      );
      const clients = await d1All(
        env.DB,
        `SELECT DISTINCT c.id,c.name
          FROM ewa_requests r
          JOIN clients c ON c.id=r.client_id
          WHERE r.org_id=?
          ORDER BY c.name ASC
          LIMIT 200`,
        [organizationId],
      );
      const statusCounts = Object.fromEntries(statusRows.map((row) => [String(row.status || ''), Number(row.count || 0)]));
      const filteredTotal = Number(filtered?.total || 0);
      return respond({
        ok: true,
        pending: Number(summary?.pending || 0),
        total: Number(summary?.total || 0),
        filteredTotal,
        statusCounts,
        clients,
        requests: rows,
        page: { offset, limit, hasMore: offset + rows.length < filteredTotal, nextOffset: offset + rows.length },
        filters: { status, clientId, period, q },
      });
    }

    let body;
    try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
    const action = String(body.action || '').toUpperCase();
    const requestId = String(body.id || body.requestId || '').trim();
    if (!requestId) return respond({ error: 'id wajib' }, 422);
    const current = await d1First(env.DB, 'SELECT * FROM ewa_requests WHERE id=? AND org_id=? LIMIT 1', [requestId, organizationId]);
    if (!current) return respond({ error: 'Pengajuan tidak ditemukan' }, 404);

    const actorId = String(actor.email || actor.id || '').trim();
    const note = String(body.note || '').slice(0, 240);
    let nextStatus = '';
    let result;

    if (action === 'APPROVE' && current.status === 'SUBMITTED') {
      nextStatus = 'APPROVED';
      result = await d1Run(
        env.DB,
        `UPDATE ewa_requests
          SET status='APPROVED', approved_by=?, approved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              decision_note=?, decided_by=?, decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND org_id=? AND status='SUBMITTED'`,
        [actorId, note || null, actorId, requestId, organizationId],
      );
    } else if (action === 'REJECT' && current.status === 'SUBMITTED') {
      nextStatus = 'REJECTED';
      result = await d1Run(
        env.DB,
        `UPDATE ewa_requests
          SET status='REJECTED', decision_note=?, decided_by=?, decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND org_id=? AND status='SUBMITTED'`,
        [note || null, actorId, requestId, organizationId],
      );
    } else if (action === 'DISBURSE' && current.status === 'APPROVED') {
      if (String(current.approved_by || '').trim().toLowerCase() === actorId.toLowerCase()) {
        return respond({ error: 'Maker-checker: approver tidak boleh sekaligus mencairkan advance', code: 'EWA_SOD_REQUIRED' }, 409);
      }
      const source = String(body.source || body.disbursementSource || '').trim().slice(0, 40).toUpperCase();
      const reference = String(body.reference || body.disbursementReference || '').trim().slice(0, 100);
      const transactionDate = String(body.transactionDate || body.disbursementTransactionDate || '').trim().slice(0, 10);
      if (!source || !reference || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
        return respond({
          error: 'Bukti pencairan wajib lengkap: source, reference, dan transactionDate (YYYY-MM-DD)',
          code: 'EWA_DISBURSEMENT_EVIDENCE_REQUIRED',
        }, 422);
      }
      if (!current.destination_bank_name || !current.destination_account_last4) {
        return respond({ error: 'Snapshot rekening tujuan tidak tersedia. Pengajuan harus dibuat ulang.', code: 'EWA_DESTINATION_SNAPSHOT_REQUIRED' }, 409);
      }
      nextStatus = 'DISBURSED';
      result = await d1Run(
        env.DB,
        `UPDATE ewa_requests
          SET status='DISBURSED', disbursed_by=?, disbursed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              disbursement_source=?, disbursement_reference=?, disbursement_transaction_date=?,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND org_id=? AND status='APPROVED' AND approved_by IS NOT NULL AND lower(approved_by)<>lower(?)`,
        [actorId, source, reference, transactionDate, requestId, organizationId, actorId],
      );
    } else if (action === 'REPAY') {
      return respond({
        error: 'Status REPAID hanya boleh ditetapkan otomatis setelah payroll direkonsiliasi MATCHED',
        code: 'EWA_REPAY_IS_DERIVED',
      }, 409);
    } else {
      return respond({ error: 'Aksi tidak valid untuk status saat ini' }, 409);
    }

    const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
    if (changes !== 1) {
      return respond({ error: 'Status pengajuan berubah. Muat ulang sebelum memproses kembali.', code: 'EWA_CONCURRENT_TRANSITION' }, 409);
    }

    await d1Run(
      env.DB,
      `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
        VALUES (?, ?, ?, ?, ?, ?, 'ewa_request', ?)`,
      [
        `AUD-${crypto.randomUUID()}`, organizationId, actorId, actor.role,
        `EWA_${nextStatus}`,
        nextStatus === 'DISBURSED'
          ? `${requestId} · ${current.employee_id} · ${String(body.source || body.disbursementSource || '').trim().slice(0, 40).toUpperCase()} · ${String(body.reference || body.disbursementReference || '').trim().slice(0, 100)}`
          : `${requestId} · ${current.employee_id}`,
        requestId,
      ],
    );
    const updated = await d1First(env.DB, 'SELECT * FROM ewa_requests WHERE id=? AND org_id=?', [requestId, organizationId]);
    return respond({ ok: true, request: updated });
  } catch (error) {
    return respond({ error: 'EWA request failed', ...publicError(error, crypto.randomUUID()) }, 500);
  }
}
