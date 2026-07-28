import { neon } from '@neondatabase/serverless';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';
const CONFIRMATION = 'HAPUS KLIEN';

function getUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);

  const authorization = await authorize(request, env, { roles: ['SUPER_ADMIN'], mutating: true, methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'client-delete', METHODS);
  if (limited) return limited;

  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  let body;
  try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
  if (body?.confirmation !== CONFIRMATION || !body?.clientId) {
    return respond({ error: 'clientId dan konfirmasi HAPUS KLIEN wajib diisi' }, 422);
  }

  const url = getUrl(env);
  if (!url) return respond({ error: 'Service unavailable' }, 503);
  const sql = neon(url);
  const requestId = crypto.randomUUID();

  try {
    const clients = await sql`
      SELECT c.id, c.name,
        (SELECT COUNT(*)::int FROM employees e WHERE e.client_id = c.id) AS employee_count
      FROM clients c WHERE c.id = ${String(body.clientId)} LIMIT 1
    `;
    if (!clients.length) return respond({ error: 'Klien tidak ditemukan' }, 404);
    const client = clients[0];

    await sql.transaction((tx) => [
      tx`DELETE FROM ar_monitor WHERE company = ${client.name}`,
      tx`DELETE FROM invoices WHERE client_id = ${client.id} OR company = ${client.name}`,
      tx`DELETE FROM payments WHERE payroll_id IN (
        SELECT p.id FROM payrolls p
        WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p.details) d WHERE d->>'company' = ${client.name})
      )`,
      tx`DELETE FROM approvals WHERE payroll_id IN (
        SELECT p.id FROM payrolls p
        WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p.details) d WHERE d->>'company' = ${client.name})
      )`,
      tx`
        UPDATE payrolls p SET
          details = scoped.details,
          employee_count = scoped.employee_count,
          total_gross = scoped.total_gross,
          total_deduction = scoped.total_deduction,
          total_net = scoped.total_net,
          status = 'DRAFT',
          updated_at = NOW()
        FROM (
          SELECT p2.id,
            COALESCE(jsonb_agg(d) FILTER (WHERE d IS NOT NULL AND d->>'company' <> ${client.name}), '[]'::jsonb) AS details,
            COUNT(d) FILTER (WHERE d IS NOT NULL AND d->>'company' <> ${client.name})::int AS employee_count,
            COALESCE(SUM((d->>'gross')::bigint) FILTER (WHERE d IS NOT NULL AND d->>'company' <> ${client.name}), 0)::bigint AS total_gross,
            COALESCE(SUM((d->>'deductions')::bigint) FILTER (WHERE d IS NOT NULL AND d->>'company' <> ${client.name}), 0)::bigint AS total_deduction,
            COALESCE(SUM((d->>'net')::bigint) FILTER (WHERE d IS NOT NULL AND d->>'company' <> ${client.name}), 0)::bigint AS total_net
          FROM payrolls p2
          LEFT JOIN LATERAL jsonb_array_elements(p2.details) d ON TRUE
          WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p2.details) hit WHERE hit->>'company' = ${client.name})
          GROUP BY p2.id
        ) scoped
        WHERE p.id = scoped.id
      `,
      tx`DELETE FROM employees WHERE client_id = ${client.id}`,
      tx`DELETE FROM work_locations wl WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.location_id = wl.id)`,
      tx`DELETE FROM branches b WHERE NOT EXISTS (SELECT 1 FROM work_locations wl WHERE wl.branch_id = b.id)`,
      tx`DELETE FROM clients WHERE id = ${client.id}`,
      tx`
        INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
        VALUES (
          ${'LOG-CLIENT-DELETE-' + crypto.randomUUID()}, 'ORG-OTSINDO',
          ${authorization.actor.email}, ${authorization.actor.role}, 'CLIENT_DELETED',
          ${`Deleted ${client.name} with ${client.employee_count} employees; affected payrolls returned to DRAFT`},
          'Client', ${client.id}
        )
      `,
    ]);

    return respond({ ok: true, atomic: true, deleted: { clientId: client.id, clientName: client.name, employees: client.employee_count }, affectedPayrollsResetToDraft: true });
  } catch (error) {
    return respond({ ok: false, ...publicError(error, requestId) }, 500);
  }
}
