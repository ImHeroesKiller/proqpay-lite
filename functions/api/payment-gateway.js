import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { decryptAccountNumber } from './payment-instruction-core.js';
import {
  PaymentGatewayConfigurationError,
  createGatewayPayment,
  gatewayIdempotencyKey,
  gatewayReadiness,
  gatewayRequestHash,
} from './payment-gateway-core.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER'];
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function orgId(env) {
  return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

function auditOperation(organizationId, actor, action, detail, entityId) {
  return {
    statement: `INSERT INTO audit_logs (id,org_id,username,role,action,detail,entity,entity_id)
      VALUES (?,?,?,?,?,?,?,?)`,
    bindings: [`AUD-${crypto.randomUUID()}`, organizationId, actor.email, actor.role, action, detail, 'payment_instruction', entityId],
  };
}

async function approvedInstruction(database, organizationId, paymentInstructionId) {
  return d1First(database, `SELECT pi.*,
      COALESCE((SELECT SUM(pil.amount) FROM payment_instruction_lines pil WHERE pil.payment_instruction_id=pi.id),0) AS instruction_total,
      (SELECT pa.action_hash FROM payment_approvals pa WHERE pa.payment_instruction_id=pi.id AND pa.status='APPROVED'
        ORDER BY pa.created_at DESC LIMIT 1) AS approved_hash
    FROM payment_instructions pi WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [paymentInstructionId, organizationId]);
}

async function beneficiarySnapshot(database, paymentInstructionId, secret) {
  const rows = await d1All(database, `SELECT beneficiary_name,bank_name,bank_code,account_ciphertext,account_iv,amount,line_hash
    FROM payment_instruction_lines WHERE payment_instruction_id=? ORDER BY employee_id,id`, [paymentInstructionId]);
  return Promise.all(rows.map(async (row) => ({
    beneficiaryName: row.beneficiary_name,
    bankName: row.bank_name,
    bankCode: row.bank_code,
    accountNumber: await decryptAccountNumber(row.account_ciphertext, row.account_iv, secret),
    amount: Number(row.amount),
    lineHash: row.line_hash,
  })));
}

function validateInstruction(payment) {
  if (!payment) return { status: 404, error: 'Payment Instruction tidak ditemukan' };
  if (!['APPROVED_FOR_PAYMENT', 'DISBURSEMENT_PROCESSING'].includes(String(payment.status || ''))) {
    return { status: 409, error: `PI berstatus ${payment.status || 'UNKNOWN'} belum dapat dieksekusi melalui gateway` };
  }
  if (!payment.content_hash || payment.approved_hash !== payment.content_hash) {
    return { status: 409, error: 'Approval hash tidak cocok dengan immutable Payment Instruction', code: 'PAYMENT_APPROVAL_HASH_MISMATCH' };
  }
  if (Number(payment.expected_total) <= 0 || Number(payment.expected_total) !== Number(payment.instruction_total)) {
    return { status: 409, error: 'Control total Payment Instruction tidak seimbang', code: 'PAYMENT_CONTROL_TOTAL_MISMATCH' };
  }
  return null;
}

async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > 64 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
  return request.json();
}

async function findTransaction(database, organizationId, paymentInstructionId) {
  return d1First(database, `SELECT * FROM payment_gateway_transactions
    WHERE org_id=? AND payment_instruction_id=? ORDER BY created_at DESC LIMIT 1`, [organizationId, paymentInstructionId]);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);

  const authorization = await authorize(request, env, { roles: ROLES, mutating: request.method === 'POST', methods: METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'payment-gateway', METHODS);
  if (limited) return limited;
  if (!hasD1(env)) return secureJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);

  const database = env.DB;
  const organizationId = orgId(env);
  const readiness = gatewayReadiness(env);

  try {
    if (request.method === 'GET') {
      const paymentInstructionId = new URL(request.url).searchParams.get('paymentInstructionId');
      if (!paymentInstructionId) return secureJson({ ok: true, gateway: readiness }, 200, request, env, METHODS);
      const payment = await approvedInstruction(database, organizationId, paymentInstructionId);
      if (!payment) return secureJson({ error: 'Payment Instruction tidak ditemukan' }, 404, request, env, METHODS);
      const transaction = await findTransaction(database, organizationId, paymentInstructionId);
      return secureJson({ ok: true, gateway: readiness, transaction }, 200, request, env, METHODS);
    }

    if (!authorization.actor.permissions?.includes('payment:prepare')) {
      return secureJson({ error: 'Role tidak memiliki izin mengeksekusi pembayaran' }, 403, request, env, METHODS);
    }
    if (!readiness.configured) {
      return secureJson({ error: readiness.reason, code: 'PAYMENT_GATEWAY_NOT_READY', gateway: readiness }, 503, request, env, METHODS);
    }

    const body = await readBody(request);
    const paymentInstructionId = String(body.paymentInstructionId || '').trim();
    const paymentMethod = String(body.paymentMethod || '').trim().slice(0, 60);
    if (!paymentInstructionId) return secureJson({ error: 'paymentInstructionId wajib diisi' }, 422, request, env, METHODS);

    const payment = await approvedInstruction(database, organizationId, paymentInstructionId);
    const validation = validateInstruction(payment);
    if (validation) return secureJson(validation, validation.status, request, env, METHODS);

    const idempotencyKey = gatewayIdempotencyKey(payment);
    let transaction = await d1First(database, 'SELECT * FROM payment_gateway_transactions WHERE idempotency_key=? LIMIT 1', [idempotencyKey]);
    if (transaction && ['CREATED','PENDING','PROCESSING','SUCCEEDED'].includes(transaction.status)) {
      return secureJson({ ok: true, transaction, idempotentReplay: true, gateway: readiness }, 200, request, env, METHODS);
    }

    const beneficiaries = await beneficiarySnapshot(database, payment.id, env.PI_ENCRYPTION_KEY);
    const requestHash = await gatewayRequestHash(payment, beneficiaries.map((row) => row.lineHash), paymentMethod);
    if (!beneficiaries.length) return secureJson({ error: 'Payment Instruction tidak memiliki beneficiary' }, 409, request, env, METHODS);
    if (beneficiaries.reduce((sum, row) => sum + row.amount, 0) !== Number(payment.expected_total)) {
      return secureJson({ error: 'Beneficiary snapshot tidak sesuai control total', code: 'PAYMENT_BENEFICIARY_TOTAL_MISMATCH' }, 409, request, env, METHODS);
    }

    const transactionId = transaction?.id || `PGT-${crypto.randomUUID()}`;
    if (!transaction) {
      try {
        await d1Batch(database, [{
          statement: `INSERT INTO payment_gateway_transactions
            (id,org_id,client_id,payment_instruction_id,provider,status,amount,currency,payment_method,idempotency_key,request_hash,created_by)
            VALUES (?,?,?,?,?,'CREATED',?,?,?,?,?,?)`,
          bindings: [transactionId, organizationId, payment.client_id, payment.id, readiness.provider,
            Number(payment.expected_total), payment.currency || 'IDR', paymentMethod || null, idempotencyKey, requestHash, authorization.actor.email],
        }]);
      } catch (error) {
        if (!/UNIQUE constraint failed|idx_one_active_gateway_transaction/i.test(String(error?.message || error))) throw error;
        transaction = await d1First(database, 'SELECT * FROM payment_gateway_transactions WHERE idempotency_key=? LIMIT 1', [idempotencyKey]);
        if (transaction) return secureJson({ ok: true, transaction, idempotentReplay: true, gateway: readiness }, 200, request, env, METHODS);
        throw error;
      }
    } else {
      await d1Batch(database, [{
        statement: `UPDATE payment_gateway_transactions SET status='CREATED',error_code=NULL,error_message=NULL,
          payment_method=?,request_hash=?,updated_at=${NOW} WHERE id=?`,
        bindings: [paymentMethod || null, requestHash, transaction.id],
      }]);
    }

    try {
      const providerResult = await createGatewayPayment(env, {
        paymentInstructionId: payment.id,
        documentNo: payment.document_no,
        contentHash: payment.content_hash,
        amount: Number(payment.expected_total),
        currency: payment.currency || 'IDR',
        paymentMethod,
        idempotencyKey,
        beneficiaries,
      });
      const resultStatus = providerResult.status === 'SUCCEEDED' ? 'SUCCEEDED' : providerResult.status;
      const nextPiState = resultStatus === 'SUCCEEDED' ? 'RECONCILIATION' : 'DISBURSEMENT_PROCESSING';
      await d1Batch(database, [
        { statement: `UPDATE payment_gateway_transactions SET provider_transaction_id=?,provider_reference=?,status=?,provider_status=?,
            updated_at=${NOW},paid_at=CASE WHEN ?='SUCCEEDED' THEN ${NOW} ELSE paid_at END WHERE id=?`,
          bindings: [providerResult.providerTransactionId, providerResult.providerReference || null, resultStatus,
            providerResult.providerStatus || resultStatus, resultStatus, transactionId] },
        { statement: `UPDATE payment_instructions SET status=?,updated_at=${NOW}
            WHERE id=? AND status IN ('APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING')`, bindings: [nextPiState, payment.id] },
        { statement: `UPDATE payroll_submissions SET state=?,updated_at=${NOW}
            WHERE id=? AND state IN ('APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING')`, bindings: [nextPiState, payment.submission_id] },
        auditOperation(organizationId, authorization.actor, 'GATEWAY_PAYMENT_STARTED', `${readiness.provider} · ${transactionId} · ${payment.document_no || payment.id}`, payment.id),
      ]);
      transaction = await d1First(database, 'SELECT * FROM payment_gateway_transactions WHERE id=? LIMIT 1', [transactionId]);
      return secureJson({ ok: true, transaction, gateway: readiness }, 201, request, env, METHODS);
    } catch (error) {
      await d1Batch(database, [{ statement: `UPDATE payment_gateway_transactions SET status='FAILED',error_code=?,error_message=?,updated_at=${NOW} WHERE id=?`,
        bindings: [error instanceof PaymentGatewayConfigurationError ? 'GATEWAY_CONFIGURATION' : 'GATEWAY_REQUEST_FAILED', String(error?.message || error).slice(0, 500), transactionId] }]);
      return secureJson({ error: 'Payment gateway menolak atau gagal menerima transaksi', code: 'PAYMENT_GATEWAY_REQUEST_FAILED', transactionId }, 502, request, env, METHODS);
    }
  } catch (error) {
    const requestId = crypto.randomUUID();
    const detail = publicError(error, requestId);
    return secureJson(detail, error?.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500, request, env, METHODS);
  }
}
