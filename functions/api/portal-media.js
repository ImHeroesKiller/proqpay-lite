import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
const METHODS = 'GET, POST, OPTIONS';
const ALLOWED = new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf']);
const safeName = (value) => String(value || 'asset').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  const bucket = env.FILES || env.PAYMENT_PROOFS;
  if (!bucket) return secureJson({ error: 'R2 FILES binding unavailable', code: 'R2_REQUIRED' }, 503, request, env, METHODS);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const key = String(url.searchParams.get('key') || '');
    if (!key.startsWith('portal-media/')) return secureJson({ error: 'File tidak valid' }, 422, request, env, METHODS);
    const object = await bucket.get(key);
    if (!object) return secureJson({ error: 'File tidak ditemukan' }, 404, request, env, METHODS);
    return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  const authorization = await authorize(request, env, { roles: ['SUPER_ADMIN','PAYROLL_PROCESSOR'], mutating: true, methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'portal-media-upload', METHODS);
  if (limited) return limited;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || !file.size) return secureJson({ error: 'Pilih file untuk diunggah' }, 422, request, env, METHODS);
  if (file.size > 5 * 1024 * 1024) return secureJson({ error: 'Ukuran file maksimal 5 MB' }, 413, request, env, METHODS);
  if (!ALLOWED.has(file.type)) return secureJson({ error: 'Format harus JPG, PNG, WebP, GIF, atau PDF' }, 415, request, env, METHODS);
  const orgId = String(env.DEFAULT_ORG_ID || authorization.actor.orgId || 'ORG-OTSINDO');
  const key = `portal-media/${orgId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { uploadedBy: authorization.actor.email || authorization.actor.id } });
  return secureJson({ ok: true, key, url: `${url.origin}/api/portal-media?key=${encodeURIComponent(key)}`, name: file.name, type: file.type, size: file.size }, 200, request, env, METHODS);
}
