import { neon } from '@neondatabase/serverless';
import {
  authorize,
  enforceRateLimit,
  handlePreflight,
  publicError,
  secureJson,
} from './_security.js';
import {
  EMAIL_FILL_CONFIRMATION,
  validateEmailFillRequest,
} from './employee-email-fill-validation.js';

const METHODS = 'POST, OPTIONS';
const ORG_ID = 'ORG-OTSINDO';

function getUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR'],
    mutating: true,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    'employee-email-fill',
    METHODS
  );
  if (limited) return limited;

  const respond = (data, status = 200) =>
    secureJson(data, status, request, env, METHODS);
  let body;
  try {
    body = await request.json();
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }
  const validated = validateEmailFillRequest(body);
  if (!validated.ok) return respond({ error: validated.errors.join('; ') }, 422);

  const url = getUrl(env);
  if (!url) return respond({ error: 'Service unavailable' }, 503);
  const sql = neon(url);
  const requestId = crypto.randomUUID();
  const { planId, domain, expectedCount } = validated.value;

  try {
    const candidates = await sql`
      SELECT id, name
      FROM employees
      WHERE org_id = ${ORG_ID}
        AND (email IS NULL OR BTRIM(email) = '')
      ORDER BY id
      LIMIT 501
    `;
    if (candidates.length !== expectedCount) {
      return respond({
        error: 'Data berubah sejak preview dibuat. Buat preview email baru.',
        expectedCount,
        currentCount: candidates.length,
      }, 409);
    }

    const auditId = `LOG-EMAIL-FILL-${planId}`;
    await sql.transaction((tx) => [
      tx`
        UPDATE employees
        SET email = LOWER(REGEXP_REPLACE(id, '[^a-zA-Z0-9]+', '.', 'g')) || '@' || ${domain},
            updated_at = NOW()
        WHERE org_id = ${ORG_ID}
          AND (email IS NULL OR BTRIM(email) = '')
      `,
      tx`
        INSERT INTO audit_logs (
          id, org_id, username, role, action, detail, entity, entity_id
        )
        VALUES (
          ${auditId}, ${ORG_ID}, ${authorization.actor.email},
          ${authorization.actor.role}, 'EMPLOYEE_EMAIL_PLACEHOLDERS_FILLED',
          ${`${expectedCount} placeholder emails filled with domain ${domain}`},
          'Employee', ${planId}
        )
        ON CONFLICT (id) DO NOTHING
      `,
    ]);

    return respond({
      ok: true,
      atomic: true,
      updated: expectedCount,
      domain,
      planId,
      confirmation: EMAIL_FILL_CONFIRMATION,
    });
  } catch (error) {
    return respond({ ok: false, ...publicError(error, requestId) }, 500);
  }
}
