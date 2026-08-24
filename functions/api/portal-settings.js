import { d1All, hasD1 } from './_d1.js';
import { loadPortalSettingsForOps, savePortalSettings } from './_portal-settings.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'GET, POST, OPTIONS';
const READERS = new Set(['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER']);
const WRITERS = new Set(['SUPER_ADMIN', 'PAYROLL_PROCESSOR']);

function orgId(env, actor) {
  return String(env.DEFAULT_ORG_ID || actor?.orgId || 'ORG-OTSINDO');
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }
  const authorization = await authorize(request, env, {
    roles: [...READERS],
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'portal-settings', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);

  const actor = authorization.actor;
  const organizationId = orgId(env, actor);

  try {
    const clients = await d1All(
      env.DB,
      `SELECT id, code, name FROM clients WHERE org_id=? AND COALESCE(status,'ACTIVE')='ACTIVE' ORDER BY name LIMIT 200`,
      [organizationId],
    );

    if (request.method === 'GET') {
      const clientId = String(new URL(request.url).searchParams.get('clientId') || '').trim() || null;
      if (clientId && !clients.some((client) => client.id === clientId)) {
        return respond({ error: 'Klien tidak ditemukan', clients }, 404);
      }
      const settings = await loadPortalSettingsForOps(env.DB, organizationId, clientId);
      return respond({ ok: true, clients, ...settings });
    }

    if (!WRITERS.has(actor.role)) return respond({ error: 'Insufficient role' }, 403);
    let body;
    try { body = await request.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
    const clientId = String(body.clientId || '').trim() || null;
    if (clientId && !clients.some((client) => client.id === clientId)) {
      return respond({ error: 'Klien tidak ditemukan' }, 404);
    }
    const saved = await savePortalSettings(env.DB, {
      orgId: organizationId,
      clientId,
      actor,
      policy: body.policy,
      copy: body.copy,
      features: body.features,
      adsPlatform: body.adsPlatform,
      ads: body.ads,
      reset: Boolean(body.reset),
    });
    return respond({ ok: true, clients, ...saved });
  } catch (error) {
    return respond({ error: 'Portal settings failed', ...publicError(error, crypto.randomUUID()) }, 500);
  }
}
