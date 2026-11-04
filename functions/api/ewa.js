import { employeeEwaConfiguration } from './_ewa-entitlement.js';
import { dispatchClientNotification } from './_proqpay-notifications.js';
import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, clientIdsFor, projectIdsFor, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

function decisionUpdate(statement, bindings) { return { statement, bindings }; }

const METHODS = 'GET, POST, OPTIONS';
const OPS = new Set(['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER']);

function orgId(env, actor) {
  return String(env.DEFAULT_ORG_ID || actor?.orgId || 'ORG-OTSINDO');
}

export async function onRequest({ request, env, waitUntil }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }
  const authorization = await authorize(request, env, {
    roles: ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'],
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
  if(request.method==='POST'&&!OPS.has(actor.role)) return respond({error:'Persetujuan pengajuan EWA hanya tersedia untuk admin; disbursement dilakukan melalui Canonical DR oleh Processor/Controller.',code:'EWA_MANAGE_PERMISSION_REQUIRED'},403);

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
      if (actor.role === 'CLIENT_USER') {
        const clients = clientIdsFor(actor, env) || [];
        const projects = projectIdsFor(actor) || [];
        if (!clients.length) clauses.push('1=0');
        else {
          clauses.push(`r.client_id IN (${clients.map(()=>'?').join(',')})`);
          bindings.push(...clients);
          if(projects.length){clauses.push(`e.project_id IN (${projects.map(()=>'?').join(',')})`);bindings.push(...projects);}
        }
      }
      const scopeWhere = clauses.join(' AND ');
      const scopeBindings = [...bindings];
      if (clientId) { clauses.push('r.client_id=?'); bindings.push(clientId); }
      if (period) { clauses.push('r.period=?'); bindings.push(period); }
      if (q) {
        clauses.push('(lower(e.name) LIKE ? OR lower(e.employee_code) LIKE ? OR lower(r.id) LIKE ?)');
        const like = `%${q.toLowerCase()}%`;
        bindings.push(like, like, like);
      }
      const summaryWhere = clauses.join(' AND ');
      const summaryBindings = [...bindings];
      if (status) { clauses.push('r.status=?'); bindings.push(status); }
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
          SUM(CASE WHEN r.status='SUBMITTED' THEN 1 ELSE 0 END) AS pending,
          COUNT(*) AS total
         FROM ewa_requests r JOIN employees e ON e.id=r.employee_id WHERE ${summaryWhere}`,
        summaryBindings,
      );
      const statusRows = await d1All(
        env.DB,
        `SELECT r.status, COUNT(*) AS count
          FROM ewa_requests r JOIN employees e ON e.id=r.employee_id
          WHERE ${summaryWhere}
          GROUP BY r.status`,
        summaryBindings,
      );
      const clients = await d1All(
        env.DB,
        `SELECT DISTINCT c.id,c.name
          FROM clients c LEFT JOIN projects e ON e.client_id=c.id AND e.org_id=c.org_id
          WHERE ${scopeWhere.replaceAll('r.org_id','c.org_id').replaceAll('r.client_id','c.id').replaceAll('e.project_id','e.id')}
          ORDER BY c.name ASC
          LIMIT 200`,
        scopeBindings,
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
    if(action==='DISBURSE') return respond({error:'Pencairan EWA via bukti manual dinonaktifkan. Jalur disbursement wajib memakai Canonical DR, persetujuan dan eksekusi Payroll Controller, serta reconciliation provider.',code:'EWA_CANONICAL_EXECUTION_REQUIRED'},409);
    const requestId = String(body.id || body.requestId || '').trim();
    if (!requestId) return respond({ error: 'id wajib' }, 422);
    const current = await d1First(env.DB, 'SELECT * FROM ewa_requests WHERE id=? AND org_id=? LIMIT 1', [requestId, organizationId]);
    if (!current) return respond({ error: 'Pengajuan tidak ditemukan' }, 404);

    if (actor.role === 'CLIENT_USER') {
      const employee = await d1First(env.DB, 'SELECT project_id FROM employees WHERE id=?', [current.employee_id]);
      if (!(clientIdsFor(actor, env) || []).includes(String(current.client_id)) ||
          ((projectIdsFor(actor) || []).length > 0 && !(projectIdsFor(actor) || []).includes(String(employee?.project_id)))) return respond({error:'Pengajuan tidak ditemukan'},404);
    if(action==='REJECT' && (String(body.note||'').trim().length<5 || String(body.note||'').trim().length>240))return respond({error:'Alasan penolakan wajib 5–240 karakter',code:'EWA_REJECTION_REASON_REQUIRED'},422);
    if(action==='APPROVE' && current.configuration_version != null){
      const configuration=await employeeEwaConfiguration(env.DB,current.employee_id,organizationId,current.client_id);
      if(!configuration.enabled || configuration.settings?.version!==current.configuration_version || Number(current.amount)>configuration.limit){
        return respond({error:'Pengaturan EWA berubah. Batalkan dan ajukan ulang memakai limit terbaru.',code:'EWA_CONFIGURATION_CHANGED'},409);
      }
    }
      if (!['APPROVE','REJECT'].includes(action) || current.status !== 'SUBMITTED' || current.client_approval_status !== 'PENDING') {
        return respond({error:'Keputusan klien sudah diproses atau aksi tidak valid'},409);
      }
      const clientStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const actorId = String(actor.email || actor.id || '').trim();
      const [result] = await d1Batch(env.DB, [
        { statement: `UPDATE ewa_requests SET client_approval_status=?,client_approved_by=?,
        client_decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),client_decision_note=?,
        status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND org_id=? AND status='SUBMITTED' AND client_approval_status='PENDING'
        AND (?='REJECT' OR configuration_version IS NULL OR EXISTS(SELECT 1 FROM ewa_employee_settings cfg WHERE cfg.employee_id=ewa_requests.employee_id AND cfg.org_id=ewa_requests.org_id AND cfg.client_id=ewa_requests.client_id AND cfg.enabled=1 AND cfg.version=ewa_requests.configuration_version))`, bindings: [clientStatus,actorId,String(body.note || '').slice(0,240) || null,action === 'REJECT' ? 'REJECTED' : 'SUBMITTED',requestId,organizationId,action] },
        { statement: `INSERT INTO audit_logs (id,org_id,username,role,action,detail,entity,entity_id)
          SELECT ?,?,?,'CLIENT_USER',?,?,'ewa_request',? WHERE changes()=1`,
          bindings: [`AUD-${crypto.randomUUID()}`,organizationId,actorId,`EWA_CLIENT_${clientStatus}`,JSON.stringify({requestId,decision:clientStatus,note:String(body.note||'').trim().slice(0,240)}),requestId] },
      ]);
      if (Number(result?.meta?.changes ?? 0) !== 1) return respond({error:'Status berubah. Muat ulang.'},409);
      const updated=await d1First(env.DB,'SELECT * FROM ewa_requests WHERE id=? AND org_id=?',[requestId,organizationId]);
      if(waitUntil&&String(env.PROQPAY_NOTIFICATION_EMAIL_ENABLED||'false')==='true') waitUntil(dispatchClientNotification(env,{
        type:action==='APPROVE'?'EWA_CLIENT_APPROVED':'EWA_REJECTED',clientId:updated.client_id,reference:updated.id,
        period:updated.period,eventId:updated.id+':CLIENT_'+clientStatus+':'+String(updated.updated_at||'')
      }).catch(()=>{}));
      return respond({ok:true,request:updated});
    }
    if(['APPROVE','REJECT'].includes(action) && actor.role==='PAYROLL_CONTROLLER')return respond({error:'Processor menyiapkan pengajuan terlebih dahulu. Controller menyetujui eksekusi melalui Disbursement.',code:'EWA_PROCESSOR_REVIEW_REQUIRED'},403);
    if(action==='APPROVE' && current.configuration_version != null){
      const configuration=await employeeEwaConfiguration(env.DB,current.employee_id,organizationId,current.client_id);
      if(!configuration.enabled || configuration.settings?.version!==current.configuration_version || Number(current.amount)>configuration.limit){
        return respond({error:'Pengaturan EWA berubah. Batalkan dan ajukan ulang memakai limit terbaru.',code:'EWA_CONFIGURATION_CHANGED'},409);
      }
    }
    if(action==='REJECT' && (String(body.note||'').trim().length<5 || String(body.note||'').trim().length>240))return respond({error:'Alasan penolakan wajib 5–240 karakter',code:'EWA_REJECTION_REASON_REQUIRED'},422);
    if (['APPROVE','REJECT'].includes(action) && (current.client_approval_status !== 'APPROVED' || !current.client_approved_by)) {
      return respond({error:'Persetujuan klien wajib sebelum proses internal',code:'EWA_CLIENT_APPROVAL_REQUIRED'},409);
    }
    const actorId = String(actor.email || actor.id || '').trim();
    const note = String(body.note || '').trim().slice(0, 240);
    let nextStatus = '';
    let transition;

    if (action === 'APPROVE' && current.status === 'SUBMITTED') {
      nextStatus = 'APPROVED';
      transition = decisionUpdate(
        `UPDATE ewa_requests
          SET status='APPROVED', approved_by=?, approved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              decision_note=?, decided_by=?, decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND org_id=? AND status='SUBMITTED' AND client_approval_status='APPROVED' AND client_approved_by IS NOT NULL
            AND (configuration_version IS NULL OR EXISTS(SELECT 1 FROM ewa_employee_settings cfg WHERE cfg.employee_id=ewa_requests.employee_id AND cfg.org_id=ewa_requests.org_id AND cfg.client_id=ewa_requests.client_id AND cfg.enabled=1 AND cfg.version=ewa_requests.configuration_version))`,
        [actorId, note || null, actorId, requestId, organizationId],
      );
    } else if (action === 'REJECT' && current.status === 'SUBMITTED') {
      nextStatus = 'REJECTED';
      transition = decisionUpdate(
        `UPDATE ewa_requests
          SET status='REJECTED', decision_note=?, decided_by=?, decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND org_id=? AND status='SUBMITTED' AND client_approval_status='APPROVED' AND client_approved_by IS NOT NULL`,
        [note || null, actorId, requestId, organizationId],
      );
    } else if (action === 'REPAY') {
      return respond({
        error: 'Status REPAID hanya boleh ditetapkan otomatis setelah payroll direkonsiliasi MATCHED',
        code: 'EWA_REPAY_IS_DERIVED',
      }, 409);
    } else {
      return respond({ error: 'Aksi tidak valid untuk status saat ini' }, 409);
    }

    const [result] = await d1Batch(env.DB, [transition, {
      statement: `INSERT INTO audit_logs (id,org_id,username,role,action,detail,entity,entity_id)
        SELECT ?,?,?,?,?,?,'ewa_request',? WHERE changes()=1`,
      bindings: [`AUD-${crypto.randomUUID()}`,organizationId,actorId,actor.role,`EWA_${nextStatus}`,
        JSON.stringify({requestId,employeeId:current.employee_id,decision:nextStatus,note}),requestId],
    }]);
    if (Number(result?.meta?.changes || 0) !== 1) {
      return respond({error:'Status pengajuan berubah. Muat ulang sebelum memproses kembali.',code:'EWA_CONCURRENT_TRANSITION'},409);
    }

    const updated = await d1First(env.DB, 'SELECT * FROM ewa_requests WHERE id=? AND org_id=?', [requestId, organizationId]);
    if(waitUntil&&String(env.PROQPAY_NOTIFICATION_EMAIL_ENABLED||'false')==='true') waitUntil(dispatchClientNotification(env,{
      type:nextStatus==='APPROVED'?'EWA_APPROVED':'EWA_REJECTED',clientId:updated.client_id,reference:updated.id,
      period:updated.period,eventId:updated.id+':PROCESSOR_'+nextStatus+':'+String(updated.updated_at||'')
    }).catch(()=>{}));
    return respond({ ok: true, request: updated });
  } catch (error) {
    return respond({ error: 'EWA request failed', ...publicError(error, crypto.randomUUID()) }, 500);
  }
}
