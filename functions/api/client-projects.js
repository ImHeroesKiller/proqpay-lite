import { neon } from '@neondatabase/serverless';
import {
  authorize, clientIdsFor, projectIdsFor, enforceRateLimit, handlePreflight, publicError, secureJson,
} from './_security.js';
import { validateDirectoryAction } from './client-projects-validation.js';

const METHODS = 'GET, POST, OPTIONS';

function databaseUrl(env) {
  return env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_URL || null;
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }
  const authorization = await authorize(request, env, {
    roles: request.method === 'POST' ? ['SUPER_ADMIN', 'PAYROLL_PROCESSOR'] : undefined,
    mutating: request.method === 'POST', methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'client-project-directory', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  const url = databaseUrl(env);
  if (!url) return respond({ error: 'Service unavailable', requestId }, 503);
  const sql = neon(url);
  const actor = authorization.actor;
  const organizationId = String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
  try {
    if (request.method === 'GET') {
      const scope = clientIdsFor(actor, env);
      const scopeCsv = (scope || []).join(',');
      const projectScope = projectIdsFor(actor);
      const projectScopeCsv = (projectScope || []).join(',');
      const [clients, projects] = await Promise.all([
        sql`SELECT c.id, c.code, c.name, c.created_at,
          COUNT(DISTINCT e.id)::int AS employee_count,
          COUNT(DISTINCT p.id)::int AS project_count,
          (SELECT COUNT(*)::int FROM user_client_scopes ucs WHERE ucs.client_id=c.id) AS assigned_user_count
          FROM clients c
          LEFT JOIN employees e ON e.client_id=c.id
          LEFT JOIN projects p ON p.client_id=c.id
          WHERE c.org_id=${organizationId}
            AND (${actor.role !== 'CLIENT_USER'} OR c.id = ANY(string_to_array(${scopeCsv}, ',')))
          GROUP BY c.id ORDER BY c.name`,
        sql`SELECT p.*, c.name AS client_name,
          (SELECT COUNT(*)::int FROM user_project_scopes ups WHERE ups.project_id=p.id) AS assigned_user_count
          FROM projects p JOIN clients c ON c.id=p.client_id
          WHERE p.org_id=${organizationId}
            AND (${actor.role !== 'CLIENT_USER'} OR p.client_id = ANY(string_to_array(${scopeCsv}, ',')))
            AND (${actor.role !== 'CLIENT_USER' || !projectScope?.length} OR p.id = ANY(string_to_array(${projectScopeCsv}, ',')))
          ORDER BY p.created_at DESC LIMIT 500`,
      ]);
      return respond({ ok: true, clients, projects, role: actor.role });
    }
    const raw = await request.json().catch(() => null);
    const validation = validateDirectoryAction(raw);
    if (!validation.ok) return respond({ error: validation.errors.join('; ') }, 422);
    const body = validation.value;
    if (body.action === 'CREATE_CLIENT') {
      const id = body.id || `CLI-${crypto.randomUUID()}`;
      const rows = await sql`INSERT INTO clients (id, org_id, code, name)
        VALUES (${id}, ${organizationId}, ${body.code}, ${body.name}) RETURNING *`;
      return respond({ ok: true, client: rows[0] }, 201);
    }
    if (body.action === 'UPDATE_CLIENT') {
      const rows = await sql`UPDATE clients SET code=${body.code}, name=${body.name}
        WHERE id=${body.id} AND org_id=${organizationId} RETURNING *`;
      if (!rows.length) return respond({ error: 'Client not found' }, 404);
      return respond({ ok: true, client: rows[0] });
    }
    const client = await sql`SELECT id FROM clients WHERE id=${body.clientId} AND org_id=${organizationId} LIMIT 1`;
    if (!client.length) return respond({ error: 'Client not found' }, 404);
    if (body.action === 'UPDATE_PROJECT') {
      const rows = await sql`UPDATE projects SET client_id=${body.clientId}, code=${body.code}, name=${body.name},
        status=${body.status || 'ACTIVE'}, start_date=${body.startDate || null}, end_date=${body.endDate || null}, updated_at=NOW()
        WHERE id=${body.id} AND org_id=${organizationId} RETURNING *`;
      if (!rows.length) return respond({ error: 'Project not found' }, 404);
      return respond({ ok: true, project: rows[0] });
    }
    const id = body.id || `PRJ-${crypto.randomUUID()}`;
    const rows = await sql`INSERT INTO projects
      (id, org_id, client_id, code, name, status, start_date, end_date, province, created_by)
      VALUES (${id}, ${organizationId}, ${body.clientId}, ${body.code}, ${body.name}, 'ACTIVE',
        ${body.startDate || null}, ${body.endDate || null}, ${body.province || null}, ${actor.email})
      RETURNING *`;
    return respond({ ok: true, project: rows[0] }, 201);
  } catch (error) {
    if (String(error?.message || '').includes('duplicate key')) return respond({ error: 'Code sudah digunakan' }, 409);
    return respond(publicError(error, requestId), 500);
  }
}
