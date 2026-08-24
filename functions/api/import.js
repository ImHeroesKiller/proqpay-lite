import { hasD1 } from './_d1.js';
import { importRowsD1 } from './import-d1.js';
import { MAX_IMPORT_BYTES, validateImportRows } from './import-validation.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';

const METHODS = 'POST, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') {
    return secureJson({ error: 'POST only — send { rows: ParsedEmployee[] }' }, 405, request, env, METHODS);
  }
  const authorization = await authorize(request, env, {
    roles: ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'CLIENT_USER'],
    mutating: true,
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'employee-import', METHODS);
  if (limited) return limited;
  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  if (!hasD1(env)) {
    return respond({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED', requestId }, 503);
  }
  if (Number(request.headers.get('content-length') || 0) > MAX_IMPORT_BYTES) {
    return respond({ error: `Payload maksimal ${MAX_IMPORT_BYTES} byte` }, 413);
  }
  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_IMPORT_BYTES) {
      return respond({ error: `Payload maksimal ${MAX_IMPORT_BYTES} byte` }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }

  // UPLOAD_FINAL is a controlled financial-source workflow. JSON-only imports are
  // prohibited because they lose the original Excel bytes and source checksum.
  if (body?.context) {
    return respond({
      error: 'Upload payroll final wajib melalui menu Reports > Upload Payroll Final agar file Excel asli, SHA-256, row hash dan control total tersimpan.',
      code: 'PAYROLL_PROVENANCE_REQUIRED',
    }, 409);
  }

  // Client users cannot mutate HR/master records through the legacy import path.
  if (authorization.actor.role === 'CLIENT_USER') {
    return respond({ error: 'Client user tidak memiliki akses ke master import', code: 'MASTER_IMPORT_FORBIDDEN' }, 403);
  }

  const validation = validateImportRows(body.rows);
  if (!validation.ok) {
    return respond({ ok: false, error: 'Import validation failed', issues: validation.issues }, 422);
  }
  return importRowsD1({
    env,
    actor: authorization.actor,
    body,
    rows: validation.rows,
    respond,
    requestId,
  });
}
