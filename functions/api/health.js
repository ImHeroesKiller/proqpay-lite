import { neon } from '@neondatabase/serverless';
import { handlePreflight, publicError, secureJson } from './_security.js';

const METHODS = 'GET, OPTIONS';
const AI_KEYS = ['GEMINI_WORKER_1','GEMINI_WORKER_2','GEMINI_WORKER_3','GEMINI_WORKER_4','GEMINI_WORKER_5'];

function getUrl(env) {
  return env.DATABASE_URL || env.NETLIFY_DB_URL || env.NETLIFY_DATABASE_URL || env.POSTGRES_URL || env.NEON_DATABASE_URL || null;
}

function check(key, label, status, message, action) {
  return { key, label, status, message, ...(action ? { action } : {}) };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);

  const requestId = crypto.randomUUID();
  const checks = [];
  const storageReady = Boolean(env.PAYMENT_PROOFS?.put && env.PAYMENT_PROOFS?.get);
  checks.push(storageReady
    ? check('payment_proofs','Penyimpanan bukti bayar','ok','R2 terhubung.')
    : check('payment_proofs','Penyimpanan bukti bayar','error','Upload dan unduh bukti pembayaran belum tersedia.','Tambahkan R2 binding PAYMENT_PROOFS pada Production dan Preview, lalu redeploy.'));

  const aiReady = AI_KEYS.some((name) => Boolean(env[name]));
  checks.push(aiReady
    ? check('ida_ai','IDA AI','ok','Minimal satu Gemini worker tersedia.')
    : check('ida_ai','IDA AI','warning','Fallback AI generatif belum dikonfigurasi.','Tambahkan minimal GEMINI_WORKER_1 sebagai secret Production.'));

  checks.push(env.TAVILY_API_KEY
    ? check('ida_web','IDA Web Search','ok','DuckDuckGo aktif dengan fallback Tavily.')
    : check('ida_web','IDA Web Search','warning','DuckDuckGo aktif, tetapi fallback Tavily belum dikonfigurasi.','Tambahkan TAVILY_API_KEY sebagai secret Production agar pencarian otomatis memiliki fallback.'));

  const authMode = String(env.AUTH_MODE || 'origin').toLowerCase();
  const accessReady = authMode !== 'access' || Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
  checks.push(accessReady
    ? check('authentication','Autentikasi','ok',authMode === 'access' ? 'Cloudflare Access terhubung.' : 'Mode login aplikasi aktif.')
    : check('authentication','Autentikasi','error','Cloudflare Access dipilih tetapi konfigurasinya belum lengkap.','Isi CF_ACCESS_TEAM_DOMAIN dan CF_ACCESS_AUD.'));

  const url = getUrl(env);
  if (!url) {
    checks.unshift(check('database','Database','error','Koneksi database belum dikonfigurasi.','Tambahkan DATABASE_URL pada Production.'));
    return secureJson({ status:'error', ready:false, service:'proqpay-lite', checks, requestId }, 503, request, env, METHODS);
  }

  try {
    const sql = neon(url);
    const rows = await sql`SELECT 1 AS ok, NOW() AS server_time`;
    checks.unshift(check('database','Database','ok','Neon PostgreSQL terhubung.'));
    const hasError = checks.some((item) => item.status === 'error');
    const hasWarning = checks.some((item) => item.status === 'warning');
    return secureJson({
      status: hasError ? 'error' : hasWarning ? 'degraded' : 'ok',
      ready: !hasError,
      database: 'connected',
      server_time: rows[0]?.server_time,
      service: 'proqpay-lite',
      host: 'cloudflare-pages',
      auth_mode: authMode === 'access' ? 'access' : 'origin',
      checks,
    }, 200, request, env, METHODS);
  } catch (error) {
    checks.unshift(check('database','Database','error','Database tidak dapat dihubungi.','Periksa DATABASE_URL dan status Neon.'));
    return secureJson({ ...publicError(error, requestId), ready:false, service:'proqpay-lite', checks }, 503, request, env, METHODS);
  }
}
