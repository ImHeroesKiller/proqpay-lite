import { d1Batch, d1First, hasD1 } from './_d1.js';
import {
  authorize, enforceRateLimit, handlePreflight, publicError, secureJson,
} from './_security.js';
import {
  paymentProofObjectKey, safeProofFilename, validatePaymentProofContent, validatePaymentProofFile, validPaymentProofDate,
} from './payment-proof-validation.js';

const METHODS = 'GET, POST, OPTIONS';
const READ_ROLES = ['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'];
const WRITE_ROLES = ['SUPER_ADMIN','PAYROLL_PROCESSOR'];
const MANUAL_PROOF_STATUSES = new Set(['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','RECONCILIATION','PAYMENT_EXCEPTION']);

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

function canAccessProject(actor, projectId) {
  if (actor.role !== 'CLIENT_USER' || !Array.isArray(actor.projectIds) || !actor.projectIds.length) return true;
  return Boolean(projectId && actor.projectIds.map(String).includes(String(projectId)));
}

function field(form, name) {
  return String(form.get(name) || '').trim();
}

function normalizedKey(value) {
  return String(value || '').trim().toUpperCase();
}

function sameProofPayload(existing, amount, transactionDate) {
  return Number(existing?.amount) === amount
    && String(existing?.transaction_date || '').slice(0, 10) === transactionDate;
}

async function blockingGatewayTransaction(database, paymentInstructionId) {
  try {
    return await d1First(database, `SELECT id,provider,status,provider_transaction_id,provider_reference,provider_status,error_code,created_at
      FROM payment_gateway_transactions WHERE payment_instruction_id=?
      AND (
        status IN ('CREATED','PENDING','PROCESSING','SUCCEEDED')
        OR (status='FAILED' AND (
          UPPER(COALESCE(error_code,'')) LIKE '%UNKNOWN%' OR UPPER(COALESCE(provider_status,'')) LIKE '%AWAITING%'
        ))
      )
      ORDER BY CASE WHEN status='SUCCEEDED' THEN 0 WHEN status IN ('PENDING','PROCESSING') THEN 1 ELSE 2 END,created_at DESC LIMIT 1`, [paymentInstructionId]);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return null;
    throw error;
  }
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
      const proof = await d1First(database, `SELECT pp.*, pi.org_id, pi.client_id, s.project_id FROM payment_proofs pp
        JOIN payment_instructions pi ON pi.id=pp.payment_instruction_id
        JOIN payroll_submissions s ON s.id=pi.submission_id
        WHERE pp.id=? AND pi.org_id=? LIMIT 1`, [proofId, organizationId]);
      if (!proof) return respond({ error: 'Bukti pembayaran tidak ditemukan' }, 404);
      if (!canAccessClient(authorization.actor, env, proof.client_id) || !canAccessProject(authorization.actor, proof.project_id)) {
        return respond({ error: 'Akun tidak memiliki akses ke bukti pembayaran ini' }, 403);
      }
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
    const fileBytes = await file.arrayBuffer();
    const contentValidation = validatePaymentProofContent(file, fileBytes);
    if (!contentValidation.ok) return respond({ error: contentValidation.errors.join('; '), code:'PAYMENT_PROOF_FILE_SIGNATURE_INVALID' }, 422);
    const paymentInstructionId = field(form, 'paymentInstructionId');
    const bank = normalizedKey(field(form, 'bank'));
    const reference = normalizedKey(field(form, 'reference'));
    const transactionDate = field(form, 'transactionDate');
    const amount = Number(field(form, 'amount'));
    if (!paymentInstructionId || !bank || !reference || !validPaymentProofDate(transactionDate) || !Number.isSafeInteger(amount) || amount <= 0) {
      return respond({ error: 'Metadata bukti pembayaran tidak valid' }, 422);
    }

    const payment = await d1First(database, `SELECT pi.*,s.project_id FROM payment_instructions pi
      JOIN payroll_submissions s ON s.id=pi.submission_id
      WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [paymentInstructionId, organizationId]);
    if (!payment) return respond({ error: 'Payment instruction tidak ditemukan' }, 404);
    if (!canAccessClient(authorization.actor, env, payment.client_id) || !canAccessProject(authorization.actor, payment.project_id)) {
      return respond({ error: 'Akun tidak memiliki akses ke Payment Instruction ini' }, 403);
    }
    if (!['SUPER_ADMIN','PAYROLL_PROCESSOR'].includes(authorization.actor.role) || !authorization.actor.permissions?.includes('payment:prepare')) {
      return respond({ error:'Pencatatan bukti pembayaran membutuhkan role Payroll Processor dan izin payment:prepare', code:'PAYMENT_PROOF_WRITE_PERMISSION_REQUIRED' },403);
    }
    if (!MANUAL_PROOF_STATUSES.has(String(payment.status || '').toUpperCase())) {
      return respond({ error: 'Payment instruction belum disetujui atau belum siap menerima bukti pembayaran' }, 409);
    }
    const gateway = await blockingGatewayTransaction(database, paymentInstructionId);
    if (gateway?.status === 'SUCCEEDED') {
      return respond({ error: 'Payment gateway sudah menyatakan transaksi berhasil. Rekonsiliasi harus mengikuti webhook provider, bukan bukti manual.', code: 'PAYMENT_GATEWAY_SETTLED' }, 409);
    }
    if (gateway) {
      return respond({
        error: gateway.status === 'FAILED'
          ? `Transaksi gateway ${gateway.provider} memiliki jejak provider/hasil ambigu. Fallback manual diblokir sampai status provider dikonfirmasi.`
          : `Transaksi gateway ${gateway.provider} masih ${gateway.status}. Selesaikan atau tunggu hasil gateway sebelum memakai fallback manual.`,
        code: gateway.status === 'FAILED' ? 'PAYMENT_GATEWAY_AMBIGUOUS_FAILURE' : 'PAYMENT_GATEWAY_ACTIVE',
      }, 409);
    }
    const currentProofTotal = await d1First(database, `SELECT COALESCE(SUM(amount),0) AS total FROM payment_proofs WHERE payment_instruction_id=?`, [paymentInstructionId]);
    if (Number(currentProofTotal?.total || 0) + amount > Number(payment.expected_total || 0)) {
      return respond({
        error:'Total bukti pembayaran akan melebihi nilai Payment Instruction',
        code:'PAYMENT_PROOF_TOTAL_EXCEEDS_PI',
        currentTotal:Number(currentProofTotal?.total || 0),
        attemptedAmount:amount,
        expectedTotal:Number(payment.expected_total || 0),
      },409);
    }
    const existing = await d1First(database, `SELECT * FROM payment_proofs
      WHERE payment_instruction_id=? AND UPPER(bank)=? AND UPPER(reference)=? LIMIT 1`, [paymentInstructionId, bank, reference]);
    if (existing) {
      if (!sameProofPayload(existing, amount, transactionDate)) return respond({ error: 'Referensi bank sudah digunakan dengan metadata berbeda' }, 409);
      return respond({ ok: true, paymentProof: existing, idempotentReplay: true });
    }
    const proofId = `PP-${crypto.randomUUID()}`;
    const key = paymentProofObjectKey(organizationId, paymentInstructionId, file.name);
    const nextProofTotal = Number(currentProofTotal?.total || 0) + amount;
    const evidenceComplete = nextProofTotal === Number(payment.expected_total || 0);
    await bucket.put(key, fileBytes, {
      httpMetadata: { contentType: contentValidation.detectedType || file.type },
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
        { statement: `UPDATE payment_instructions SET status=CASE WHEN ?=1 THEN 'PROOF_UPLOADED' ELSE status END,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, bindings: [evidenceComplete ? 1 : 0, paymentInstructionId] },
        { statement: `UPDATE payroll_submissions SET state=CASE WHEN ?=1 THEN 'PROOF_UPLOADED' ELSE state END,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=(SELECT submission_id FROM payment_instructions WHERE id=?)`, bindings: [evidenceComplete ? 1 : 0, paymentInstructionId] },
        { statement: `INSERT INTO audit_logs (id,org_id,username,role,action,detail,entity,entity_id)
          VALUES (?,?,?,?,'PAYMENT_PROOF_UPLOADED',?,'payment_proof',?)`,
          bindings: [`AUD-${crypto.randomUUID()}`, organizationId, authorization.actor.email, authorization.actor.role,
            `${bank} · ${reference} · ${file.size} bytes`, proofId] },
      ]);
      return respond({ ok: true, paymentProof: results[0]?.results?.[0], evidenceComplete, proofTotal:nextProofTotal, expectedTotal:Number(payment.expected_total || 0) }, 201);
    } catch (error) {
      await bucket.delete(key);
      if (/UNIQUE constraint|payment_proofs/i.test(String(error?.message || error))) {
        const replay = await d1First(database, `SELECT * FROM payment_proofs
          WHERE payment_instruction_id=? AND UPPER(bank)=? AND UPPER(reference)=? LIMIT 1`, [paymentInstructionId, bank, reference]);
        if (replay) {
          if (!sameProofPayload(replay, amount, transactionDate)) return respond({ error: 'Referensi bank sudah digunakan dengan metadata berbeda' }, 409);
          return respond({ ok: true, paymentProof: replay, idempotentReplay: true });
        }
      }
      throw error;
    }
  } catch (error) {
    return respond(publicError(error, requestId), 500);
  }
}
