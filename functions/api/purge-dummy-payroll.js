import { neon } from '@neondatabase/serverless';
import {
  authorize,
  enforceRateLimit,
  handlePreflight,
  publicError,
  secureJson,
} from './_security.js';

const METHODS = 'POST, OPTIONS';
const CONFIRMATION = 'HAPUS PAYMENT LEGACY DAN PAYROLL DUMMY';

function databaseUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

function orgId(env) {
  return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

export async function onRequest({ request, env }) {
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

  const limited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    'purge-dummy-payroll',
    METHODS
  );
  if (limited) return limited;

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

  const url = databaseUrl(env);
  if (!url) return respond({ error: 'Service unavailable' }, 503);
  const sql = neon(url);
  const organizationId = orgId(env);
  const requestId = crypto.randomUUID();

  try {
    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM payment_instructions WHERE org_id=${organizationId}) AS payment_instructions,
        (SELECT COUNT(*)::int FROM payment_proofs pp JOIN payment_instructions pi ON pi.id=pp.payment_instruction_id WHERE pi.org_id=${organizationId}) AS payment_proofs,
        (SELECT COUNT(*)::int FROM payroll_submissions WHERE org_id=${organizationId}) AS payroll_submissions,
        (SELECT COUNT(*)::int FROM payrolls WHERE org_id=${organizationId}) AS payrolls,
        (SELECT COUNT(*)::int FROM invoices WHERE org_id=${organizationId}) AS invoices,
        (SELECT COUNT(*)::int FROM payments WHERE org_id=${organizationId}) AS legacy_payments
    `;
    const proofRows = await sql`
      SELECT pp.uploaded_file_id
      FROM payment_proofs pp
      JOIN payment_instructions pi ON pi.id=pp.payment_instruction_id
      WHERE pi.org_id=${organizationId}
    `;

    await sql.transaction((tx) => [
      tx`DELETE FROM ar_monitor WHERE org_id=${organizationId}`,
      tx`DELETE FROM invoices WHERE org_id=${organizationId}`,
      tx`DELETE FROM reconciliations WHERE payment_instruction_id IN (SELECT id FROM payment_instructions WHERE org_id=${organizationId})`,
      tx`DELETE FROM payment_approvals WHERE payment_instruction_id IN (SELECT id FROM payment_instructions WHERE org_id=${organizationId})`,
      tx`DELETE FROM payment_proofs WHERE payment_instruction_id IN (SELECT id FROM payment_instructions WHERE org_id=${organizationId})`,
      tx`DELETE FROM payment_instruction_lines WHERE payment_instruction_id IN (SELECT id FROM payment_instructions WHERE org_id=${organizationId})`,
      tx`DELETE FROM payment_instructions WHERE org_id=${organizationId}`,
      tx`DELETE FROM payroll_exceptions WHERE submission_id IN (SELECT id FROM payroll_submissions WHERE org_id=${organizationId})`,
      tx`DELETE FROM submission_versions WHERE submission_id IN (SELECT id FROM payroll_submissions WHERE org_id=${organizationId})`,
      tx`DELETE FROM payroll_submissions WHERE org_id=${organizationId}`,
      tx`DELETE FROM payments WHERE org_id=${organizationId}`,
      tx`DELETE FROM approvals WHERE org_id=${organizationId}`,
      tx`DELETE FROM payrolls WHERE org_id=${organizationId}`,
      tx`UPDATE employee_compensation ec SET payroll_source_period=NULL, imported_gross=0,
          imported_deduction=0, imported_net=0, payroll_components='{}'::jsonb, updated_at=NOW()
          WHERE EXISTS (SELECT 1 FROM employees e WHERE e.id=ec.employee_id AND e.org_id=${organizationId})`,
      tx`INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity)
          VALUES (${'AUD-' + crypto.randomUUID()}, ${organizationId}, ${authorization.actor.email},
          ${authorization.actor.role}, 'DUMMY_PAYROLL_PURGED', ${JSON.stringify(counts || {})}, 'System')`,
    ]);

    const proofCleanup = { requested: proofRows.length, deleted: 0, failed: [] };
    if (proofRows.length && env.PAYMENT_PROOFS?.delete) {
      for (const row of proofRows) {
        try {
          await env.PAYMENT_PROOFS.delete(row.uploaded_file_id);
          proofCleanup.deleted += 1;
        } catch {
          proofCleanup.failed.push(row.uploaded_file_id);
        }
      }
    } else if (proofRows.length) {
      proofCleanup.failed = proofRows.map((row) => row.uploaded_file_id);
    }

    return respond({
      ok: true,
      atomicDatabasePurge: true,
      deleted: counts || {},
      proofCleanup,
      preserved: ['employees', 'employee master data', 'employee bank accounts', 'clients', 'projects', 'service plans', 'users', 'settings', 'IDA knowledge and memory'],
    });
  } catch (error) {
    return respond({ ok: false, ...publicError(error, requestId) }, 500);
  }
}
