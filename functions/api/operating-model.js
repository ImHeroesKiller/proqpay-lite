import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { d1First, hasD1 } from './_d1.js';
import { handleD1OperatingModel } from './operating-model-d1.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER', 'CLIENT_USER'];
const RECONCILIABLE_STATUSES = new Set(['PROOF_UPLOADED', 'RECONCILIATION', 'PAYMENT_EXCEPTION']);

async function guardSensitivePaymentActions(request, env) {
  if (request.method !== 'POST') return null;
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  if (body?.action !== 'RECONCILE_PAYMENT') return null;
  const paymentInstructionId = String(body.paymentInstructionId || '').trim();
  if (!paymentInstructionId) {
    return { status: 422, data: { error: 'paymentInstructionId wajib diisi' } };
  }
  const payment = await d1First(env.DB, `SELECT pi.id,pi.status,
    COALESCE((SELECT COUNT(*) FROM payment_proofs pp WHERE pp.payment_instruction_id=pi.id),0) AS proof_count
    FROM payment_instructions pi WHERE pi.id=? AND pi.org_id=? LIMIT 1`,
  [paymentInstructionId, String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO')]);
  if (!payment) return { status: 404, data: { error: 'Payment instruction not found' } };
  if (payment.status === 'COMPLETED') {
    const reconciliation = await d1First(env.DB, 'SELECT * FROM reconciliations WHERE payment_instruction_id=? LIMIT 1', [payment.id]);
    return { status: 200, data: { ok: true, reconciliation, idempotentReplay: true } };
  }
  if (!RECONCILIABLE_STATUSES.has(String(payment.status || '').toUpperCase())) {
    return { status: 409, data: { error: `PI berstatus ${payment.status || 'UNKNOWN'} belum dapat direkonsiliasi` } };
  }
  if (Number(payment.proof_count || 0) <= 0) {
    return { status: 409, data: { error: 'Bukti pembayaran belum tersedia untuk rekonsiliasi' } };
  }
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  }
  const authorization = await authorize(request, env, {
    roles: ROLES,
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'operating-model', METHODS);
  if (limited) return limited;
  if (!hasD1(env)) {
    return secureJson(
      { error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' },
      503,
      request,
      env,
      METHODS
    );
  }
  const guarded = await guardSensitivePaymentActions(request, env);
  if (guarded) return secureJson(guarded.data, guarded.status, request, env, METHODS);
  return handleD1OperatingModel(context, authorization.actor);
}
