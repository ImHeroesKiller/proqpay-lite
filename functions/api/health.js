import { handlePreflight, publicError, secureJson } from './_security.js';
import { d1First, hasD1 } from './_d1.js';

const METHODS = 'GET, OPTIONS';
const check = (key, label, status, message, action) => ({ key, label, status, message, ...(action ? { action } : {}) });

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);

  const checks = [];
  const proofBucket = env.FILES || env.PAYMENT_PROOFS;
  checks.push(proofBucket?.put && proofBucket?.get
    ? check('payment_proofs', 'Penyimpanan bukti bayar', 'ok', 'R2 terhubung.')
    : check('payment_proofs', 'Penyimpanan bukti bayar', 'error', 'R2 belum tersedia.', 'Tambahkan binding R2 FILES lalu redeploy.'));
  checks.push(env.PI_ENCRYPTION_KEY && String(env.PI_ENCRYPTION_KEY).length >= 32
    ? check('pi_encryption', 'Enkripsi Payment Instruction', 'ok', 'AES-256-GCM siap digunakan.')
    : check('pi_encryption', 'Enkripsi Payment Instruction', 'error', 'PI baru dan bank file diblokir.', 'Tambahkan secret PI_ENCRYPTION_KEY minimal 32 karakter.'));
  checks.push(env.AI?.run
    ? check('ida_ai', 'IDA AI', 'ok', 'Cloudflare Workers AI terhubung.')
    : check('ida_ai', 'IDA AI', 'warning', 'Binding Workers AI belum tersedia.', 'Tambahkan binding AI lalu redeploy.'));

  const authMode = String(env.AUTH_MODE || 'origin').toLowerCase();
  const accessReady = authMode !== 'access' || Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
  checks.push(accessReady
    ? check('authentication', 'Autentikasi', 'ok', authMode === 'access' ? 'Cloudflare Access terhubung.' : 'Mode login aplikasi aktif.')
    : check('authentication', 'Autentikasi', 'error', 'Cloudflare Access belum lengkap.', 'Isi CF_ACCESS_TEAM_DOMAIN dan CF_ACCESS_AUD.'));

  if (!hasD1(env)) {
    checks.unshift(check('database', 'Database', 'error', 'Binding D1 DB tidak tersedia.', 'Tambahkan binding D1 bernama DB lalu redeploy.'));
    return secureJson({ status: 'error', ready: false, database: 'd1', service: 'proqpay-lite', checks }, 503, request, env, METHODS);
  }
  const requestId = crypto.randomUUID();
  try {
    const row = await d1First(env.DB, "SELECT 1 AS ok, datetime('now') AS server_time");
    checks.unshift(check('database', 'Database', 'ok', 'Cloudflare D1 terhubung.'));
    const hasError = checks.some((item) => item.status === 'error');
    const hasWarning = checks.some((item) => item.status === 'warning');
    return secureJson({
      status: hasError ? 'error' : hasWarning ? 'degraded' : 'ok',
      ready: !hasError,
      database: 'd1',
      server_time: row?.server_time,
      service: 'proqpay-lite',
      host: 'cloudflare-pages',
      auth_mode: ['access', 'database', 'session'].includes(authMode) ? authMode : 'origin',
      checks,
    }, 200, request, env, METHODS);
  } catch (error) {
    checks.unshift(check('database', 'Database', 'error', 'Cloudflare D1 tidak dapat dihubungi.', 'Periksa binding DB dan migration D1.'));
    return secureJson({ ...publicError(error, requestId), ready: false, service: 'proqpay-lite', checks }, 503, request, env, METHODS);
  }
}
