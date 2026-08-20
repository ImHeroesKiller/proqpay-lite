import { d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';
const CONFIRMATION = 'HAPUS KLIEN';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ['SUPER_ADMIN'], mutating: true, methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'client-delete', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);

  let body;
  try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
  const clientId = String(body?.clientId || '');
  if (!clientId || body?.confirmation !== CONFIRMATION) {
    return respond({ error: 'clientId dan konfirmasi HAPUS KLIEN wajib diisi' }, 422);
  }

  const requestId = crypto.randomUUID();
  try {
    const client = await d1First(env.DB, `SELECT c.id,c.name,
      (SELECT COUNT(*) FROM employees e WHERE e.client_id=c.id) AS employee_count,
      (SELECT COUNT(*) FROM payroll_submissions s WHERE s.client_id=c.id) AS submissions,
      (SELECT COUNT(*) FROM payment_instructions pi WHERE pi.client_id=c.id) AS payment_instructions,
      (SELECT COUNT(*) FROM invoices i WHERE i.client_id=c.id) AS invoices,
      (SELECT COUNT(*) FROM ar_monitor ar WHERE ar.client_id=c.id) AS ar_records
      FROM clients c WHERE c.id=?`, [clientId]);
    if (!client) return respond({ error: 'Klien tidak ditemukan' }, 404);
    const historyCount = Number(client.submissions) + Number(client.payment_instructions) + Number(client.invoices) + Number(client.ar_records);
    if (historyCount > 0) {
      return respond({
        error: 'Klien memiliki riwayat payroll atau finansial dan tidak boleh dihapus.',
        code: 'CLIENT_HISTORY_IMMUTABLE',
        references: {
          submissions: Number(client.submissions),
          paymentInstructions: Number(client.payment_instructions),
          invoices: Number(client.invoices),
          ar: Number(client.ar_records),
        },
      }, 409);
    }

    const auditId = `AUD-CLIENT-DELETE-${crypto.randomUUID()}`;
    await d1Batch(env.DB, [
      { statement: 'DELETE FROM integration_sync_runs WHERE connection_id IN (SELECT id FROM integration_connections WHERE client_id=?)', bindings: [clientId] },
      { statement: 'DELETE FROM integration_connections WHERE client_id=?', bindings: [clientId] },
      { statement: 'DELETE FROM billing_rules WHERE client_id=?', bindings: [clientId] },
      { statement: 'DELETE FROM client_service_plans WHERE client_id=?', bindings: [clientId] },
      { statement: 'DELETE FROM employee_education WHERE employee_id IN (SELECT id FROM employees WHERE client_id=?)', bindings: [clientId] },
      { statement: 'DELETE FROM employee_bpjs WHERE employee_id IN (SELECT id FROM employees WHERE client_id=?)', bindings: [clientId] },
      { statement: 'DELETE FROM employee_bank_accounts WHERE employee_id IN (SELECT id FROM employees WHERE client_id=?)', bindings: [clientId] },
      { statement: 'DELETE FROM employee_compensation WHERE employee_id IN (SELECT id FROM employees WHERE client_id=?)', bindings: [clientId] },
      { statement: 'DELETE FROM employee_assignments WHERE employee_id IN (SELECT id FROM employees WHERE client_id=?)', bindings: [clientId] },
      { statement: 'DELETE FROM employee_contracts WHERE employee_id IN (SELECT id FROM employees WHERE client_id=?)', bindings: [clientId] },
      { statement: 'DELETE FROM employee_identity WHERE employee_id IN (SELECT id FROM employees WHERE client_id=?)', bindings: [clientId] },
      { statement: 'DELETE FROM employee_hris_meta WHERE employee_id IN (SELECT id FROM employees WHERE client_id=?)', bindings: [clientId] },
      { statement: 'DELETE FROM employees WHERE client_id=?', bindings: [clientId] },
      { statement: 'DELETE FROM projects WHERE client_id=?', bindings: [clientId] },
      { statement: 'DELETE FROM clients WHERE id=?', bindings: [clientId] },
      { statement: `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?,?,?)`, bindings: [auditId, env.DEFAULT_ORG_ID || 'ORG-OTSINDO', authorization.actor.email, authorization.actor.role, 'CLIENT_DELETED', `Deleted ${client.name} with ${client.employee_count} employees`, 'Client', clientId] },
    ]);
    return respond({ ok: true, atomic: true, deleted: { clientId, clientName: client.name, employees: Number(client.employee_count) } });
  } catch (error) {
    return respond({ ok: false, ...publicError(error, requestId) }, 500);
  }
}
