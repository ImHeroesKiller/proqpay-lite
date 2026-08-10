import { neon } from '@neondatabase/serverless';
import {
  authorize,
  enforceRateLimit,
  handlePreflight,
  publicError,
  secureJson,
} from './_security.js';

const METHODS = 'POST, OPTIONS';
const CONFIRMATION = 'HAPUS SEMUA DATA';

function getUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: ['SUPER_ADMIN'],
    mutating: true,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;

  const rateLimited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    'full-data-reset',
    METHODS
  );
  if (rateLimited) return rateLimited;

  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  let body;
  try {
    body = await request.json();
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }
  if (body?.confirmation !== CONFIRMATION) {
    return respond({ error: `Konfirmasi wajib: ${CONFIRMATION}` }, 422);
  }

  const url = getUrl(env);
  if (!url) return respond({ error: 'Service unavailable' }, 503);
  const sql = neon(url);
  const requestId = crypto.randomUUID();

  try {
    const counts = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM employees) AS employees,
        (SELECT COUNT(*)::int FROM clients) AS clients,
        (SELECT COUNT(*)::int FROM payrolls) AS payrolls,
        (SELECT COUNT(*)::int FROM invoices) AS invoices
    `;

    await sql.transaction((tx) => [
      tx`DELETE FROM audit_logs`,
      tx`DELETE FROM ar_monitor`,
      tx`DELETE FROM payments`,
      tx`DELETE FROM approvals`,
      tx`DELETE FROM invoices`,
      tx`DELETE FROM payrolls`,
      tx`DELETE FROM employee_hris_meta`,
      tx`DELETE FROM employee_education`,
      tx`DELETE FROM employee_bpjs`,
      tx`DELETE FROM employee_bank_accounts`,
      tx`DELETE FROM employee_compensation`,
      tx`DELETE FROM employee_assignments`,
      tx`DELETE FROM employee_contracts`,
      tx`DELETE FROM employee_identity`,
      tx`DELETE FROM employees`,
      tx`DELETE FROM work_locations`,
      tx`DELETE FROM branches`,
      tx`DELETE FROM projects`,
      tx`DELETE FROM clients`,
      tx`
        INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity)
        VALUES (
          ${'LOG-RESET-' + crypto.randomUUID()},
          'ORG-OTSINDO',
          ${authorization.actor.email},
          ${authorization.actor.role},
          'FULL_DATA_RESET',
          ${`Reset by ${authorization.actor.email}: ${JSON.stringify(counts[0] || {})}`},
          'System'
        )
      `,
    ]);

    return respond({
      ok: true,
      atomic: true,
      deleted: counts[0] || {},
      preserved: [
        'organizations',
        'provinces',
        'application settings',
        'IDA knowledge',
        'ida_messages',
        'ida_memories',
      ],
    });
  } catch (error) {
    return respond({ ok: false, ...publicError(error, requestId) }, 500);
  }
}
