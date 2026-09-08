import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1Batch, d1First, hasD1 } from './_d1.js';
import { gatewayIdempotencyKey } from './payment-gateway-core.js';
import {
  allowedReturnPath,
  createHostedCheckout,
  generateHostedState,
  hostedReadiness,
  hostedSessionTtlSeconds,
  hostedStateHash,
} from './payment-gateway-hosted-core.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL_CONTROLLER'];
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function orgId(env) { return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }

async function paymentSnapshot(database, organizationId, paymentInstructionId) {
  return d1First(database, `SELECT pi.*,
      COALESCE((SELECT SUM(pil.amount) FROM payment_instruction_lines pil WHERE pil.payment_instruction_id=pi.id),0) AS instruction_total,
      (SELECT pa.action_hash FROM payment_approvals pa WHERE pa.payment_instruction_id=pi.id AND pa.status='APPROVED'
        ORDER BY pa.created_at DESC LIMIT 1) AS approved_hash
    FROM payment_instructions pi WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [paymentInstructionId, organizationId]);
}

function validatePayment(payment) {
  if (!payment) return { status:404, error:'Payment Instruction tidak ditemukan' };
  if (!['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING'].includes(String(payment.status || ''))) {
    return { status:409, error:`PI berstatus ${payment.status || 'UNKNOWN'} belum dapat membuka Hosted Payment` };
  }
  if (!payment.content_hash || payment.approved_hash !== payment.content_hash) {
    return { status:409, error:'Approval hash tidak cocok dengan immutable Payment Instruction', code:'PAYMENT_APPROVAL_HASH_MISMATCH' };
  }
  if (Number(payment.expected_total) <= 0 || Number(payment.expected_total) !== Number(payment.instruction_total)) {
    return { status:409, error:'Control total Payment Instruction tidak seimbang', code:'PAYMENT_CONTROL_TOTAL_MISMATCH' };
  }
  return null;
}

async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > 32 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
  return request.json();
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET','POST'].includes(request.method)) return secureJson({ error:'Method not allowed' },405,request,env,METHODS);
  const authorization = await authorize(request, env, { roles:ROLES, mutating:request.method==='POST', methods:METHODS });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request,env,authorization.actor,'payment-gateway-hosted',METHODS);
  if (limited) return limited;
  if (!hasD1(env)) return secureJson({ error:'Cloudflare D1 binding unavailable',code:'D1_REQUIRED' },503,request,env,METHODS);

  const database = env.DB;
  const organizationId = orgId(env);
  const readiness = hostedReadiness(env);

  try {
    if (request.method === 'GET') {
      const paymentInstructionId = new URL(request.url).searchParams.get('paymentInstructionId');
      if (!paymentInstructionId) return secureJson({ ok:true,hosted:readiness },200,request,env,METHODS);
      const session = await d1First(database, `SELECT id,payment_instruction_id,payment_gateway_transaction_id,provider,provider_session_id,
        status,checkout_url,return_path,expires_at,returned_at,completed_at,created_at,updated_at
        FROM hosted_payment_sessions WHERE org_id=? AND payment_instruction_id=? ORDER BY created_at DESC LIMIT 1`,
        [organizationId,paymentInstructionId]);
      return secureJson({ ok:true,hosted:readiness,session },200,request,env,METHODS);
    }

    if (!authorization.actor.permissions?.includes('payment:prepare')) {
      return secureJson({ error:'Role tidak memiliki izin memulai Hosted Payment' },403,request,env,METHODS);
    }
    if (!readiness.configured) return secureJson({ error:readiness.reason,code:'HOSTED_PAYMENT_NOT_READY',hosted:readiness },503,request,env,METHODS);

    const body = await readBody(request);
    const paymentInstructionId = String(body.paymentInstructionId || '').trim();
    if (!paymentInstructionId) return secureJson({ error:'paymentInstructionId wajib diisi' },422,request,env,METHODS);
    const returnPath = allowedReturnPath(env, body.returnPath || '/?view=payments');
    const payment = await paymentSnapshot(database,organizationId,paymentInstructionId);
    const validation = validatePayment(payment);
    if (validation) return secureJson(validation,validation.status,request,env,METHODS);

    let existing = await d1First(database, `SELECT * FROM hosted_payment_sessions WHERE payment_instruction_id=?
      AND status IN ('CREATED','READY','OPENED','RETURNED') ORDER BY created_at DESC LIMIT 1`, [payment.id]);
    if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
      return secureJson({ ok:true,session:existing,hosted:readiness,idempotentReplay:true },200,request,env,METHODS);
    }
    if (existing) {
      await d1Batch(database,[{ statement:`UPDATE hosted_payment_sessions SET status='EXPIRED',updated_at=${NOW} WHERE id=?`,bindings:[existing.id] }]);
    }

    const state = generateHostedState();
    const stateHash = await hostedStateHash(state);
    const ttl = hostedSessionTtlSeconds(env);
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const sessionId = `HPS-${crypto.randomUUID()}`;
    const transactionId = `PGT-${crypto.randomUUID()}`;
    const idempotencyKey = `${gatewayIdempotencyKey(payment)}-HOSTED`;
    const requestHash = await hostedStateHash(`${payment.content_hash}:${returnPath}:${expiresAt}`);

    const provider = await createHostedCheckout(env, {
      sessionId,
      paymentInstructionId:payment.id,
      documentNo:payment.document_no,
      amount:Number(payment.expected_total),
      currency:payment.currency || 'IDR',
      idempotencyKey,
      state,
      returnUrl:`${new URL(request.url).origin}/api/payment-gateway-hosted-return?sessionId=${encodeURIComponent(sessionId)}&state=${encodeURIComponent(state)}`,
      expiresAt,
    });

    await d1Batch(database,[
      { statement:`INSERT INTO payment_gateway_transactions
          (id,org_id,client_id,payment_instruction_id,provider,provider_transaction_id,provider_reference,status,amount,currency,payment_method,idempotency_key,request_hash,created_by)
          VALUES (?,?,?,?,?,?,?,'PENDING',?,?,'HOSTED',?,?,?)`,
        bindings:[transactionId,organizationId,payment.client_id,payment.id,readiness.provider,provider.providerSessionId,
          payment.id,Number(payment.expected_total),payment.currency || 'IDR',idempotencyKey,requestHash,authorization.actor.email] },
      { statement:`INSERT INTO hosted_payment_sessions
          (id,org_id,client_id,payment_instruction_id,payment_gateway_transaction_id,provider,provider_session_id,status,checkout_url,return_path,state_hash,expires_at,created_by)
          VALUES (?,?,?,?,?,?,?,'READY',?,?,?,?,?)`,
        bindings:[sessionId,organizationId,payment.client_id,payment.id,transactionId,readiness.provider,provider.providerSessionId,
          provider.checkoutUrl,returnPath,stateHash,expiresAt,authorization.actor.email] },
      { statement:`UPDATE payment_instructions SET status='DISBURSEMENT_PROCESSING',updated_at=${NOW}
          WHERE id=? AND status='APPROVED_FOR_PAYMENT'`,bindings:[payment.id] },
      { statement:`UPDATE payroll_submissions SET state='DISBURSEMENT_PROCESSING',updated_at=${NOW}
          WHERE id=? AND state='APPROVED_FOR_PAYMENT'`,bindings:[payment.submission_id] },
      { statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
          VALUES(?,?,?,?,?,?,?,?)`,bindings:[`AUD-${crypto.randomUUID()}`,organizationId,authorization.actor.email,authorization.actor.role,
          'HOSTED_PAYMENT_SESSION_CREATED',`${readiness.provider} · ${sessionId} · expires ${expiresAt}`,'payment_instruction',payment.id] },
    ]);

    const session = await d1First(database, `SELECT id,payment_instruction_id,payment_gateway_transaction_id,provider,provider_session_id,
      status,checkout_url,return_path,expires_at,created_at FROM hosted_payment_sessions WHERE id=?`,[sessionId]);
    return secureJson({ ok:true,session,hosted:readiness },201,request,env,METHODS);
  } catch (error) {
    const requestId=crypto.randomUUID();
    const detail=publicError(error,requestId);
    return secureJson(detail,error?.message==='PAYLOAD_TOO_LARGE'?413:500,request,env,METHODS);
  }
}
