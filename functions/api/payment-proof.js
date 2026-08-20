import { d1Batch, d1First, hasD1 } from './_d1.js';
import {
  authorize, enforceRateLimit, handlePreflight, publicError, secureJson,
} from './_security.js';
import {
  paymentProofObjectKey, safeProofFilename, validatePaymentProofFile,
} from './payment-proof-validation.js';

const METHODS = 'GET, POST, OPTIONS';
const READ_ROLES = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'];
const WRITE_ROLES = ['SUPER_ADMIN','PAYROLL_CONTROLLER'];

function orgId(env) {
  return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

function clientScope(actor, env) {
  if (actor.role !== 'CLIENT_USER') return null;
  if (Array.isArray(actor.clientIds)) return new Set(actor.clientIds.map(String));
  try {
    const map = JSON.parse(env.CLIENT_SCOPE_JSON || '{}');
    const value = map[String(actor.email || '').toLowerCase()];
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}

function canAccessClient(actor, env, clientId) {
  const scope = clientScope(actor, env);
  return !scope || scope.has(String(clientId));
}

function field(form, name) {
  return String(form.get(name) || '').trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET','POST'].includes(request.method)) return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);

  const authorization = await authorize(request, env, {
    roles: request.method === 'POST' ? WRITE_ROLES : READ_ROLES,
    mutating: request.method === 'POST', methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'payment-proof', METHODS);
  if (limited) return limited;

  const respond = (data, status = 200) => secureJson(data, status, request, env, METHODS);
  const requestId = crypto.randomUUID();
  const bucket = env.FILES || env.PAYMENT_PROOFS;
  if (!bucket?.put || !bucket?.get) {
    return respond({ error: 'Penyimpanan bukti pembayaran belum terhubung. Tambahkan R2 binding FILES di Cloudflare Pages.', requestId }, 503);
  }
  if (!hasD1(env)) return respond({ error: 'Cloudflare D1 belum terhubung.', requestId }, 503);
  const database = env.DB;
  const organizationId = orgId(env);

  try {
    if (request.method === 'GET') {
      const proofId = new URL(request.url).searchParams.get('id');
      if (!proofId) return respond({ error: 'ID bukti pembayaran wajib diisi' }, 400);
      const proof = await d1First(database, `SELECT pp.*, pi.org_id, pi.client_id FROM payment_proofs pp
        JOIN payment_instructions pi ON pi.id=pp.payment_instruction_id
        WHERE pp.id=? AND pi.org_id=? LIMIT 1`, [proofId, organizationId]);
      if (!proof) return respond({ error: 'Bukti pembayaran tidak ditemukan' }, 404);
      if (!canAccessClient(authorization.actor, env, proof.client_id)) return respond({ error: 'Akun tidak memiliki akses ke data klien ini' }, 403);
      const object = await bucket.get(proof.uploaded_file_id);
      if (!object) return respond({ error: 'File bukti pembayaran tidak ditemukan di R2' }, 404);
      const headers = new Headers({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${safeProofFilename(object.customMetadata?.originalName || `${proof.id}.bin`)}"`,
        'X-Content-Type-Options': 'nosniff',
      });
      object.writeHttpMetadata(headers);
      return new Response(object.body, { headers });
    }

    const length = Number(request.headers.get('content-length') || 0);
    if (length > 6 * 1024 * 1024) return respond({ error: 'Ukuran file terlalu besar. Maksimal 5 MB.' }, 413);
    const form = await request.formData();
    const file = form.get('file');
    const validation = validatePaymentProofFile(file);
    if (!validation.ok) return respond({ error: validation.errors.join('; ') }, 422);
    const paymentInstructionId = field(form, 'paymentInstructionId');
    const bank = field(form, 'bank');
    const reference = field(form, 'reference');
    const transactionDate = field(form, 'transactionDate');
    const amount = Number(field(form, 'amount'));
    if (!paymentInstructionId || !bank || !reference || !validDate(transactionDate) || !Number.isSafeInteger(amount) || amount <= 0) {
      return respond({ error: 'Metadata bukti pembayaran tidak valid' }, 422);
    }

    const payment = await d1First(database, 'SELECT * FROM payment_instructions WHERE id=? AND org_id=? LIMIT 1', [paymentInstructionId, organizationId]);
    if (!payment) return respond({ error: 'Payment instruction tidak ditemukan' }, 404);
    if (!canAccessClient(authorization.actor, env, payment.client_id)) return respond({ error: 'Akun tidak memiliki akses ke data klien ini' }, 403);
    if (!['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED'].includes(payment.status)) {
      return respond({ error: 'Payment instruction belum disetujui atau belum siap menerima bukti pembayaran' }, 409);
    }
    const existing = await d1First(database, `SELECT * FROM payment_proofs
      WHERE payment_instruction_id=? AND bank=? AND reference=? LIMIT 1`, [paymentInstructionId, bank, reference]);
    if (existing) {
      const samePayload = Number(existing.amount) === amount
        && String(existing.transaction_date).slice(0, 10) === transactionDate;
      if (!samePayload) return respond({ error: 'Referensi bank sudah digunakan dengan metadata berbeda' }, 409);
      return respond({ ok: true, paymentProof: existing, idempotentReplay: true });
    }
    const proofId = `PP-${crypto.randomUUID()}`;
    const key = paymentProofObjectKey(organizationId, paymentInstructionId, file.name);
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        originalName: safeProofFilename(file.name),
        paymentInstructionId,
        uploadedBy: authorization.actor.email,
      },
    });
    try {
      const results = await d1Batch(database, [
        { statement: `INSERT INTO payment_proofs
          (id, payment_instruction_id, bank, reference, transaction_date, amount, uploaded_file_id)
          VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`, bindings: [proofId, paymentInstructionId, bank, reference, transactionDate, amount, key] },
        { statement: `UPDATE payment_instructions SET status='PROOF_UPLOADED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, bindings: [paymentInstructionId] },
        { statement: `UPDATE payroll_submissions SET state='PROOF_UPLOADED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=(SELECT submission_id FROM payment_instructions WHERE id=?)`, bindings: [paymentInstructionId] },
        { statement: `INSERT INTO audit_logs (id,org_id,username,role,action,detail,entity,entity_id)
          VALUES (?,?,?,?,'PAYMENT_PROOF_UPLOADED',?,'payment_proof',?)`,
          bindings: [`AUD-${crypto.randomUUID()}`, organizationId, authorization.actor.email, authorization.actor.role,
            `${bank} · ${reference} · ${file.size} bytes`, proofId] },
      ]);
      return respond({ ok: true, paymentProof: results[0]?.results?.[0] }, 201);
    } catch (error) {
      await bucket.delete(key);
      throw error;
    }
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
