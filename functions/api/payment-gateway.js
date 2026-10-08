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
import {
  executeE2PayBatch,
  reconcileE2PayBatch,
  verifyFailedE2PayBatch,
  isRetryableE2PayFailure,
  isE2PayRetryCandidate,
} from './payment-gateway-e2pay-service.js';
import { e2payHostReadiness } from './payment-gateway-e2pay.js';
import { gatewayRuntimeEnv } from './payment-gateway-settings-store.js';
import { arGateMessage, evaluateClientArGate } from './ar-payment-control.js';
import { actorFraudDecision, beneficiaryFraudDecision, paymentLimitDecision } from './_fraud-controls.js';
import { recordFraudIncident } from './_fraud-incidents.js';
import { hasRecentMfa, mfaEnforcementMode } from './_security-context.js';
import { activeProviderAccount, liquidityState, validatePaymentProviderSnapshot } from './payment-provider-routing.js';
import { scopedE2PayRuntimeEnv } from './payment-provider-account-credentials.js';

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
      COALESCE((SELECT COUNT(*) FROM payment_instruction_lines pil WHERE pil.payment_instruction_id=pi.id),0) AS instruction_count,
      (SELECT pa.action_hash FROM payment_approvals pa WHERE pa.payment_instruction_id=pi.id AND pa.status='APPROVED'
        ORDER BY pa.created_at DESC LIMIT 1) AS approved_hash,
      COALESCE((SELECT ps.period FROM payroll_submissions ps WHERE ps.id=pi.submission_id),'') AS context_payroll_period
    FROM payment_instructions pi WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [paymentInstructionId, organizationId]);
}

async function beneficiarySnapshot(database, paymentInstructionId, secret) {
  const rows = await d1All(database, `SELECT id,employee_id,beneficiary_name,bank_name,bank_code,account_ciphertext,account_iv,amount,line_hash
    FROM payment_instruction_lines WHERE payment_instruction_id=? ORDER BY employee_id,id`, [paymentInstructionId]);
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    employeeId: row.employee_id,
    beneficiaryName: row.beneficiary_name,
    bankName: row.bank_name,
    bankCode: row.bank_code,
    accountNumber: await decryptAccountNumber(row.account_ciphertext, row.account_iv, secret),
    amount: Number(row.amount),
    lineHash: row.line_hash,
  })));
}

function paymentPeriodContextError(payment, expectedPeriod) {
  const expected = String(expectedPeriod || '').trim();
  const actual = String(payment?.context_payroll_period || '').trim();
  if (!expected) {
    return { status:422, error:'Payroll period context wajib untuk aksi payment gateway', code:'PAYMENT_PERIOD_CONTEXT_REQUIRED' };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(expected)) {
    return { status:422, error:'Payroll period context tidak valid', code:'PAYMENT_PERIOD_CONTEXT_INVALID' };
  }
  if (!actual || actual !== expected) {
    return {
      status:409,
      error:`Payment Instruction periode ${actual || 'UNKNOWN'} tidak sesuai workspace periode ${expected}`,
      code:'PAYMENT_PERIOD_CONTEXT_MISMATCH',
      expectedPeriod:expected,
      paymentPeriod:actual || null,
    };
  }
  return null;
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
  if (Number(payment.recipient_count) <= 0 || Number(payment.recipient_count) !== Number(payment.instruction_count)) {
    return { status: 409, error: 'Jumlah penerima Payment Instruction tidak sesuai snapshot', code: 'PAYMENT_RECIPIENT_COUNT_MISMATCH' };
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

function publicTransaction(row) {
  if (!row) return null;
  const {
    execution_lock_token,
    request_hash,
    idempotency_key,
    ...safe
  } = row;
  return safe;
}

function publicGatewayItem(row) {
  if(!row) return row;
  const { request_diagnostics_json, ...safe }=row;
  let request_diagnostics=null;
  if(request_diagnostics_json){
    try{ request_diagnostics=JSON.parse(request_diagnostics_json); }catch{}
  }
  return { ...safe, request_diagnostics };
}

export function buildGatewayTimeline(transaction, items = []) {
  const events = [];
  if (transaction?.created_at) events.push({
    id:`tx-created-${transaction.id}`,
    at:transaction.created_at,
    type:'TRANSACTION_CREATED',
    status:transaction.status || 'CREATED',
    label:'Execution ledger dibuat',
    detail:transaction.provider ? `Provider ${transaction.provider}` : 'Payment gateway',
  });
  if (transaction?.paid_at) events.push({
    id:`tx-paid-${transaction.id}`,
    at:transaction.paid_at,
    type:'TRANSACTION_SETTLED',
    status:'SUCCEEDED',
    label:'Provider payment settled',
    detail:transaction.provider_reference || transaction.provider_transaction_id || null,
  });

  for (const item of items) {
    const suffix=String(item.account_last4 || '').padStart(4,'•');
    if (item.created_at) events.push({
      id:`item-created-${item.id}`,
      at:item.created_at,
      type:'BENEFICIARY_CREATED',
      status:'CREATED',
      label:`Beneficiary ••••${suffix} masuk execution ledger`,
      detail:item.client_ref || null,
      itemId:item.id,
    });
    if (item.last_attempt_at) events.push({
      id:`item-attempt-${item.id}-${item.attempt_count || 0}`,
      at:item.last_attempt_at,
      type:'FINANCIAL_ATTEMPT',
      status:item.status || 'PENDING',
      label:`Attempt ${Number(item.attempt_count || 0)} · ••••${suffix}`,
      detail:item.failure_stage || 'DISBURSEMENT_POST',
      itemId:item.id,
    });
    const checkedAt=item.last_checked_at || item.updated_at;
    if (checkedAt) events.push({
      id:`item-status-${item.id}-${checkedAt}`,
      at:checkedAt,
      type:'BENEFICIARY_STATUS',
      status:item.status || 'UNKNOWN',
      label:`Status ••••${suffix} · ${String(item.status || 'UNKNOWN').replaceAll('_',' ')}`,
      detail:item.error_message || item.response_message || item.response_code || null,
      itemId:item.id,
    });
  }

  return events
    .filter((event)=>event.at)
    .sort((a,b)=>String(b.at).localeCompare(String(a.at)))
    .slice(0,200);
}

export function gatewayOperationalStatus(transaction, items = [], nowMs = Date.now()) {
  if (!transaction) return {
    state:'IDLE', stale:false, staleMinutes:0, needsReconciliation:false, safeToRetry:false,
    activeLease:false, unresolvedItems:0, failedItems:0, succeededItems:0, lastActivityAt:null,
  };
  const unresolved = items.filter((item) => ['PENDING','PROCESSING','UNKNOWN'].includes(String(item.status || '')));
  const failed = items.filter((item) => String(item.status || '') === 'FAILED');
  const succeeded = items.filter((item) => String(item.status || '') === 'SUCCEEDED');
  const retryableItems = items.filter((item) => isE2PayRetryCandidate(item));
  const retryReadyItems = items.filter((item) => String(item.status || '') === 'RETRY_READY');
  const blockingFailed = failed.filter((item) => !isRetryableE2PayFailure(item));
  const itemActivity = items.map((item) => item.last_checked_at || item.updated_at || item.created_at).filter(Boolean).sort().at(-1);
  const lastActivityAt = itemActivity || transaction.updated_at || transaction.created_at || null;
  const ageMs = lastActivityAt ? Math.max(0, nowMs - new Date(lastActivityAt).getTime()) : 0;
  const staleMinutes = Math.floor(ageMs / 60000);
  const activeLease = Boolean(transaction.execution_lock_until && new Date(transaction.execution_lock_until).getTime() > nowMs);
  const status = String(transaction.status || '');
  const active = ['CREATED','PENDING','PROCESSING'].includes(status);
  const stale = active && !activeLease && staleMinutes >= 15;
  const needsReconciliation = unresolved.length > 0 || (stale && status === 'PROCESSING');
  const retryPipeline = unresolved.length === 0
    && retryableItems.length > 0
    && blockingFailed.length === 0;
  const safeToRetry = retryPipeline && (
    status === 'FAILED'
    || String(transaction.provider_status || '') === 'RETRY_READY'
    || String(transaction.provider_status || '') === 'PREFLIGHT'
  );
  const state = status === 'SUCCEEDED' ? 'SETTLED'
    : needsReconciliation ? (stale ? 'STALE' : 'RECONCILE')
    : safeToRetry ? 'RETRY_READY'
    : status === 'FAILED' ? 'FAILED'
    : active ? 'PROCESSING'
    : status || 'IDLE';
  return {
    state, stale, staleMinutes, needsReconciliation, safeToRetry, activeLease,
    unresolvedItems:unresolved.length,
    failedItems:failed.length,
    retryableFailedItems:retryableItems.length,
    retryReadyItems:retryReadyItems.length,
    blockingFailedItems:blockingFailed.length,
    succeededItems:succeeded.length,
    lastActivityAt,
  };
}

export async function acquireExecutionLease(database, transactionId) {
  const token = crypto.randomUUID();
  const locked = await d1First(database, `UPDATE payment_gateway_transactions
    SET execution_lock_token=?,execution_lock_until=datetime('now','+10 minutes'),updated_at=${NOW}
    WHERE id=? AND (execution_lock_until IS NULL OR datetime(execution_lock_until)<=datetime('now'))
    RETURNING id`, [token, transactionId]);
  return locked ? token : null;
}

export async function releaseExecutionLease(database, transactionId, token) {
  if (!token) return;
  try {
    await d1Batch(database, [{ statement:`UPDATE payment_gateway_transactions
      SET execution_lock_token=NULL,execution_lock_until=NULL,updated_at=${NOW}
      WHERE id=? AND execution_lock_token=?`, bindings:[transactionId,token] }]);
  } catch {
    // Lease expires automatically; release failure must never trigger a second financial attempt.
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET', 'POST'].includes(request.method)) return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);

  const authorization = await authorize(request, env, {
    roles: request.method === 'POST' ? ['PAYROLL_CONTROLLER'] : ROLES,
    mutating: request.method === 'POST',
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'payment-gateway', METHODS);
  if (limited) return limited;
  if (!hasD1(env)) return secureJson({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503, request, env, METHODS);

  const database = env.DB;
  const organizationId = orgId(env);
  const runtimeEnv = await gatewayRuntimeEnv(database, env, organizationId);
  const readiness = gatewayReadiness(runtimeEnv);

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const paymentInstructionId = url.searchParams.get('paymentInstructionId');
      const expectedPeriod = String(url.searchParams.get('payrollPeriod') || '').trim();
      if (!paymentInstructionId) return secureJson({ ok: true, gateway: readiness }, 200, request, env, METHODS);
      const payment = await approvedInstruction(database, organizationId, paymentInstructionId);
      if (!payment) return secureJson({ error: 'Payment Instruction tidak ditemukan' }, 404, request, env, METHODS);
      if (expectedPeriod) {
        const periodError = paymentPeriodContextError(payment, expectedPeriod);
        if (periodError) return secureJson(periodError, periodError.status, request, env, METHODS);
      }
      const transaction = await findTransaction(database, organizationId, paymentInstructionId);
      const items = transaction?.provider === 'E2PAY'
        ? await d1All(database, `SELECT id,payment_instruction_line_id,employee_id,provider,client_ref,bank_id,beneficiary_name,provider_beneficiary_name,account_last4,amount,fee_amount,journal_id,correlation_id,response_code,response_message,status,attempt_count,last_checked_at,error_code,error_message,provider_http_status,failure_stage,request_diagnostics_json,last_attempt_at,created_at,updated_at
            FROM payment_gateway_items WHERE payment_gateway_transaction_id=? ORDER BY created_at,id`, [transaction.id])
        : [];
      const operational = gatewayOperationalStatus(transaction,items);
      const arGate = await evaluateClientArGate(database, organizationId, payment.client_id);
      return secureJson({
        ok:true,
        gateway:readiness,
        transaction:publicTransaction(transaction),
        items:items.map(publicGatewayItem),
        operational,
        timeline:buildGatewayTimeline(transaction,items),
        arGate,
      },200,request,env,METHODS);
    }

    if (authorization.actor.role !== 'PAYROLL_CONTROLLER' || !authorization.actor.permissions?.includes('payment:approve')) {
      return secureJson({
        error:'Eksekusi pembayaran hanya dapat dilakukan Payroll Controller setelah approval final',
        code:'PAYMENT_CONTROLLER_EXECUTION_REQUIRED',
      },403,request,env,METHODS);
    }

    const actorFraud = await actorFraudDecision(database, organizationId, authorization.actor, runtimeEnv);
    if (actorFraud.blocked) {
      await recordFraudIncident(database,{
        orgId:organizationId,
        source:'PAYMENT_GATEWAY',
        ruleCode:actorFraud.code || 'PAYMENT_FRAUD_BLOCKED',
        severity:'HIGH',
        entity:'app_user',
        entityId:authorization.actor.id || 'SECURITY-ACTOR',
        actorUserId:authorization.actor.id || null,
        actorIpHash:authorization.actor.requestIpHash || authorization.actor.sessionIpHash || null,
        actorDeviceHash:authorization.actor.requestDeviceHash || authorization.actor.sessionDeviceHash || null,
        summary:'Payment execution blocked by actor fraud control',
        metadata:{blockId:actorFraud.blockId,blockType:actorFraud.blockType},
      });
      await d1Batch(database,[auditOperation(organizationId,authorization.actor,'PAYMENT_BLOCKED_BY_FRAUD',
        JSON.stringify({code:actorFraud.code,blockId:actorFraud.blockId,blockType:actorFraud.blockType}), 'SECURITY-ACTOR')]);
      return secureJson({
        error:'Aksi pembayaran diblokir oleh kontrol fraud.',
        code:actorFraud.code || 'PAYMENT_FRAUD_BLOCKED',
      },403,request,env,METHODS);
    }

    const body = await readBody(request);
    const paymentInstructionId = String(body.paymentInstructionId || '').trim();
    const paymentMethod = String(body.paymentMethod || '').trim().slice(0, 60);
    const expectedPeriod = String(body.payrollPeriod || '').trim();
    const action = String(body.action || 'EXECUTE').trim().toUpperCase();
    if (!paymentInstructionId) return secureJson({ error: 'paymentInstructionId wajib diisi' }, 422, request, env, METHODS);
    if (!['EXECUTE','RECONCILE','VERIFY_FAILED','RETRY_FAILED'].includes(action)) return secureJson({ error: 'action gateway tidak valid' }, 422, request, env, METHODS);

    const actionReadiness = readiness.provider === 'E2PAY'
      ? e2payHostReadiness(runtimeEnv)
      : readiness;
    if (!actionReadiness.configured) {
      return secureJson({ error: actionReadiness.reason, code: action === 'RECONCILE' ? 'E2PAY_RECONCILE_NOT_READY' : 'PAYMENT_GATEWAY_NOT_READY', gateway: readiness }, 503, request, env, METHODS);
    }

    const payment = await approvedInstruction(database, organizationId, paymentInstructionId);
    const validation = validateInstruction(payment);
    if (validation) return secureJson(validation, validation.status, request, env, METHODS);
    const periodError = paymentPeriodContextError(payment, expectedPeriod);
    if (periodError) return secureJson(periodError, periodError.status, request, env, METHODS);

    const idempotencyKey = gatewayIdempotencyKey(payment);
    let transaction = await d1First(database, 'SELECT * FROM payment_gateway_transactions WHERE idempotency_key=? LIMIT 1', [idempotencyKey]);
    const financialAction = action === 'EXECUTE' || action === 'RETRY_FAILED';
    let providerAccount=null;
    let providerLiquidity=null;
    let routedRuntimeEnv=runtimeEnv;
    if(readiness.provider==='E2PAY'){
      providerAccount=payment.provider_account_registry_id
        ? await d1First(database,`SELECT * FROM payment_provider_accounts
            WHERE id=? AND org_id=? AND provider='E2PAY' AND status='ACTIVE' LIMIT 1`,
          [payment.provider_account_registry_id,organizationId])
        : await activeProviderAccount(
          database,organizationId,payment.client_id,'E2PAY',payment.provider_environment||runtimeEnv.E2PAY_ENV
        );
      const routingValidation=validatePaymentProviderSnapshot(payment,providerAccount);
      const scopedAction=financialAction||action==='RECONCILE'||action==='VERIFY_FAILED';
      if(!routingValidation.ok && scopedAction){
        return secureJson({error:routingValidation.error,code:routingValidation.code},409,request,env,METHODS);
      }
      if(scopedAction){
        try{
          routedRuntimeEnv=await scopedE2PayRuntimeEnv(database,runtimeEnv,providerAccount);
        }catch(error){
          return secureJson({
            error:'Credential merchant E2Pay sub-account belum terhubung. Validasi merchant login pada Client/Project sebelum payment.',
            code:String(error?.code||'E2PAY_SUBACCOUNT_CREDENTIAL_REQUIRED'),
          },409,request,env,METHODS);
        }
      }
      if(financialAction){
        providerLiquidity=liquidityState(providerAccount,Number(payment.expected_total));
        if(!providerLiquidity.ready){
          return secureJson({
            error:providerLiquidity.state==='INSUFFICIENT'
              ? 'Saldo E2Pay sub-account client tidak mencukupi untuk eksekusi payment.'
              : 'Saldo E2Pay sub-account belum fresh/siap. Sync balance sebelum process payment.',
            code:'E2PAY_LIQUIDITY_'+providerLiquidity.state,
            liquidity:providerLiquidity,
          },409,request,env,METHODS);
        }
      }
    }
    const riskDecision = financialAction
      ? await paymentLimitDecision(database, organizationId, payment, { isNewExecution:action === 'EXECUTE' && !transaction })
      : null;
    if (riskDecision?.blocked) {
      await recordFraudIncident(database,{
        orgId:organizationId,
        source:'PAYMENT_GATEWAY',
        ruleCode:riskDecision.code || 'PAYMENT_LIMIT_BLOCKED',
        severity:'HIGH',
        entity:'payment_instruction',
        entityId:payment.id,
        actorUserId:authorization.actor.id || null,
        actorIpHash:authorization.actor.requestIpHash || authorization.actor.sessionIpHash || null,
        actorDeviceHash:authorization.actor.requestDeviceHash || authorization.actor.sessionDeviceHash || null,
        summary:'Payment execution exceeded configured transaction security limit',
        metadata:{
          amount:riskDecision.amount,
          recipients:riskDecision.recipients,
          projectedAmount:riskDecision.projectedAmount,
          projectedExecutions:riskDecision.projectedExecutions,
        },
      });
      await d1Batch(database,[auditOperation(organizationId,authorization.actor,'PAYMENT_BLOCKED_BY_LIMIT',
        JSON.stringify(riskDecision),payment.id)]);
      return secureJson({
        error:'Payment diblokir karena melewati security transaction limit.',
        code:riskDecision.code,
        risk:riskDecision,
      },409,request,env,METHODS);
    }
    if (financialAction && mfaEnforcementMode(runtimeEnv) === 'ENFORCE'
      && !hasRecentMfa(authorization.actor, riskDecision?.limits?.stepUpWindowSeconds || 600)) {
      return secureJson({
        error:'Verifikasi MFA terbaru diperlukan sebelum approval/eksekusi pembayaran.',
        code:'MFA_STEP_UP_REQUIRED',
        stepUpWindowSeconds:riskDecision?.limits?.stepUpWindowSeconds || 600,
      },428,request,env,METHODS);
    }
    if (transaction && transaction.provider !== readiness.provider) {
      return secureJson({ error: 'Provider gateway berbeda dari execution ledger yang sudah ada', code: 'PAYMENT_GATEWAY_PROVIDER_MISMATCH' }, 409, request, env, METHODS);
    }
    if (action === 'EXECUTE' && !transaction) {
      const arGate = await evaluateClientArGate(database, organizationId, payment.client_id);
      if (arGate.blocked) {
        await d1Batch(database,[auditOperation(organizationId,authorization.actor,'PAYMENT_BLOCKED_BY_AR',
          JSON.stringify({mode:arGate.mode,outstanding:arGate.outstanding,overdue:arGate.overdue,oldestDueDate:arGate.oldestDueDate}),payment.id)]);
        return secureJson({ error:arGateMessage(arGate), code:arGate.code, arGate },409,request,env,METHODS);
      }
    }
    if (action === 'RECONCILE') {
      if (readiness.provider !== 'E2PAY') return secureJson({ error: 'Reconcile polling hanya tersedia untuk adapter E2Pay' }, 422, request, env, METHODS);
      if (!transaction) return secureJson({ error: 'Execution ledger E2Pay belum tersedia' }, 404, request, env, METHODS);
      const reconcileLease = await acquireExecutionLease(database, transaction.id);
      if (!reconcileLease) {
        return secureJson({
          error:'PI E2Pay sedang dieksekusi atau direkonsiliasi oleh request lain.',
          code:'PAYMENT_GATEWAY_EXECUTION_BUSY',
        }, 409, request, env, METHODS);
      }
      try {
        const result = await reconcileE2PayBatch({ database, env:routedRuntimeEnv, transactionId:transaction.id, payment });
        transaction = await d1First(database, 'SELECT * FROM payment_gateway_transactions WHERE id=? LIMIT 1', [transaction.id]);
        await d1Batch(database, [auditOperation(organizationId, authorization.actor, 'E2PAY_RECONCILED',
          result.parentStatus + ' · ' + result.summary.succeeded + '/' + result.summary.total, payment.id)]);
        return secureJson({ ...result, transaction:publicTransaction(transaction), gateway:readiness }, result.statusCode, request, env, METHODS);
      } finally {
        await releaseExecutionLease(database, transaction.id, reconcileLease);
      }
    }
    if (action === 'VERIFY_FAILED') {
      if (readiness.provider !== 'E2PAY') return secureJson({ error: 'Verifikasi failed item hanya tersedia untuk adapter E2Pay' }, 422, request, env, METHODS);
      if (!transaction) return secureJson({ error: 'Execution ledger E2Pay belum tersedia' }, 404, request, env, METHODS);
      const verifyLease=await acquireExecutionLease(database,transaction.id);
      if(!verifyLease){
        return secureJson({
          error:'PI E2Pay sedang diproses oleh request lain. Muat ulang status sebelum verifikasi.',
          code:'PAYMENT_GATEWAY_EXECUTION_BUSY',
        },409,request,env,METHODS);
      }
      try{
        const result=await verifyFailedE2PayBatch({database,env:routedRuntimeEnv,transactionId:transaction.id,payment});
        transaction=await d1First(database,'SELECT * FROM payment_gateway_transactions WHERE id=? LIMIT 1',[transaction.id]);
        await d1Batch(database,[auditOperation(
          organizationId,
          authorization.actor,
          'E2PAY_FAILED_ITEMS_VERIFIED',
          `safe=${result.verifiedSafe} · providerFound=${result.providerFound} · unchanged=${result.unchanged}`,
          payment.id,
        )]);
        return secureJson({...result,transaction:publicTransaction(transaction),gateway:readiness},200,request,env,METHODS);
      }finally{
        await releaseExecutionLease(database,transaction.id,verifyLease);
      }
    }
    if (action === 'RETRY_FAILED') {
      if (readiness.provider !== 'E2PAY') return secureJson({ error: 'Retry beneficiary hanya tersedia untuk adapter E2Pay' }, 422, request, env, METHODS);
      if (!transaction) return secureJson({ error: 'Execution ledger E2Pay belum tersedia' }, 404, request, env, METHODS);
      const retryItems = await d1All(database, `SELECT status,attempt_count,response_code,error_code,error_message
        FROM payment_gateway_items WHERE payment_gateway_transaction_id=?`, [transaction.id]);
      const unresolvedRetryItems = retryItems.filter((item) => ['PENDING','PROCESSING','UNKNOWN'].includes(String(item.status || '')));
      if (unresolvedRetryItems.length > 0) {
        return secureJson({
          error:'Masih ada beneficiary dengan status provider yang belum final. Jalankan reconciliation sebelum retry.',
          code:'E2PAY_RECONCILIATION_REQUIRED',
          unresolvedItems:unresolvedRetryItems.length,
        },409,request,env,METHODS);
      }
      const retryableCount = retryItems.filter((item) => isE2PayRetryCandidate(item)).length;
      if (retryableCount <= 0) {
        return secureJson({ error:'Tidak ada beneficiary gagal yang aman untuk di-retry', code:'E2PAY_NO_RETRYABLE_FAILURES' }, 409, request, env, METHODS);
      }
    }

    if (action === 'EXECUTE' && readiness.provider === 'E2PAY' && transaction?.status === 'FAILED') {
      const failedItems = await d1All(database, `SELECT status,attempt_count,response_code,error_code,error_message
        FROM payment_gateway_items WHERE payment_gateway_transaction_id=?`, [transaction.id]);
      const recovery = gatewayOperationalStatus(transaction, failedItems);
      return secureJson({
        error: recovery.safeToRetry
          ? 'Execution E2Pay sebelumnya gagal. Gunakan Retry Aman agar recovery tetap terkontrol.'
          : 'Execution E2Pay sebelumnya gagal. Review/verifikasi status provider sebelum melakukan tindakan berikutnya.',
        code: recovery.safeToRetry ? 'E2PAY_CONTROLLED_RETRY_REQUIRED' : 'E2PAY_FAILED_REVIEW_REQUIRED',
        operational: recovery,
      },409,request,env,METHODS);
    }

    if (transaction?.status === 'SUCCEEDED') {
      return secureJson({ ok: true, transaction:publicTransaction(transaction), idempotentReplay: true, gateway: readiness }, 200, request, env, METHODS);
    }
    if (transaction && readiness.provider !== 'E2PAY' && ['CREATED','PENDING','PROCESSING'].includes(transaction.status)) {
      return secureJson({ ok: true, transaction:publicTransaction(transaction), idempotentReplay: true, gateway: readiness }, 200, request, env, METHODS);
    }

    const beneficiaries = await beneficiarySnapshot(database, payment.id, runtimeEnv.PI_ENCRYPTION_KEY);
    if (financialAction) {
      const beneficiaryFraud = await beneficiaryFraudDecision(database, organizationId, beneficiaries, runtimeEnv);
      if (beneficiaryFraud.blocked) {
        await recordFraudIncident(database,{
          orgId:organizationId,
          source:'PAYMENT_GATEWAY',
          ruleCode:beneficiaryFraud.code || 'FRAUD_BLOCK_BENEFICIARY_ACCOUNT',
          severity:'CRITICAL',
          entity:'payment_instruction',
          entityId:payment.id,
          actorUserId:authorization.actor.id || null,
          actorIpHash:authorization.actor.requestIpHash || authorization.actor.sessionIpHash || null,
          actorDeviceHash:authorization.actor.requestDeviceHash || authorization.actor.sessionDeviceHash || null,
          summary:'Payment blocked because beneficiary account matched fraud blocklist',
          metadata:{matches:beneficiaryFraud.matches.map((item)=>({
            employeeId:item.employeeId,
            accountLast4:item.accountLast4,
            blockId:item.blockId,
          }))},
        });
        await d1Batch(database,[auditOperation(organizationId,authorization.actor,'PAYMENT_BLOCKED_BY_BENEFICIARY_FRAUD',
          JSON.stringify({code:beneficiaryFraud.code,matches:beneficiaryFraud.matches}),payment.id)]);
        return secureJson({
          error:'Payment diblokir karena rekening beneficiary berada pada fraud blocklist.',
          code:beneficiaryFraud.code,
          blockedBeneficiaries:beneficiaryFraud.matches.map((item)=>({employeeId:item.employeeId,accountLast4:item.accountLast4})),
        },409,request,env,METHODS);
      }
    }
    const requestHash = await gatewayRequestHash(payment, beneficiaries.map((row) => row.lineHash), paymentMethod);
    if (transaction?.request_hash && transaction.request_hash !== requestHash) {
      return secureJson({
        error:'Execution request berbeda dari ledger gateway yang sudah tercatat.',
        code:'PAYMENT_GATEWAY_REQUEST_MISMATCH',
      }, 409, request, env, METHODS);
    }
    if (!beneficiaries.length) return secureJson({ error: 'Payment Instruction tidak memiliki beneficiary' }, 409, request, env, METHODS);
    if (beneficiaries.reduce((sum, row) => sum + row.amount, 0) !== Number(payment.expected_total)) {
      return secureJson({ error: 'Beneficiary snapshot tidak sesuai control total', code: 'PAYMENT_BENEFICIARY_TOTAL_MISMATCH' }, 409, request, env, METHODS);
    }

    let transactionId = transaction?.id || `PGT-${crypto.randomUUID()}`;
    if (!transaction) {
      try {
        await d1Batch(database, [{
          statement: `INSERT INTO payment_gateway_transactions
            (id,org_id,client_id,payment_instruction_id,provider,status,amount,currency,payment_method,idempotency_key,request_hash,created_by,
             actor_user_id,actor_ip_hash,actor_device_hash,mfa_verified_at,risk_decision_json,
             provider_account_registry_id,provider_sub_account_last4)
            VALUES (?,?,?,?,?,'CREATED',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          bindings: [transactionId, organizationId, payment.client_id, payment.id, readiness.provider,
            Number(payment.expected_total), payment.currency || 'IDR', paymentMethod || null, idempotencyKey, requestHash, authorization.actor.email,
            authorization.actor.id || null,
            authorization.actor.requestIpHash || authorization.actor.sessionIpHash || null,
            authorization.actor.requestDeviceHash || authorization.actor.sessionDeviceHash || null,
            authorization.actor.mfaVerifiedAt || null,
            riskDecision ? JSON.stringify(riskDecision) : null,
            payment.provider_account_registry_id||null,
            payment.provider_sub_account_id?String(payment.provider_sub_account_id).slice(-4):null],
        }]);
      } catch (error) {
        if (!/UNIQUE constraint failed|idx_one_active_gateway_transaction/i.test(String(error?.message || error))) throw error;
        transaction = await d1First(database, 'SELECT * FROM payment_gateway_transactions WHERE idempotency_key=? LIMIT 1', [idempotencyKey]);
        if (transaction) transactionId = transaction.id;
        if (transaction && (readiness.provider !== 'E2PAY' || transaction.status === 'SUCCEEDED')) return secureJson({ ok: true, transaction:publicTransaction(transaction), idempotentReplay: true, gateway: readiness }, 200, request, env, METHODS);
        if (!transaction) throw error;
      }
    } else if (!['CREATED','PENDING','PROCESSING'].includes(transaction.status)) {
      await d1Batch(database, [{
        statement: `UPDATE payment_gateway_transactions SET status='CREATED',error_code=NULL,error_message=NULL,
          payment_method=?,request_hash=?,updated_at=${NOW} WHERE id=?`,
        bindings: [paymentMethod || null, requestHash, transaction.id],
      }]);
    }

    if (readiness.provider === 'E2PAY') {
      const leaseToken = await acquireExecutionLease(database, transactionId);
      if (!leaseToken) {
        return secureJson({
          error:'PI E2Pay sedang diproses oleh request lain. Muat ulang status sebelum mencoba kembali.',
          code:'PAYMENT_GATEWAY_EXECUTION_BUSY',
        }, 409, request, env, METHODS);
      }
      try {
        const result = await executeE2PayBatch({ database, env:routedRuntimeEnv, transactionId, payment, beneficiaries, retryFailed:action === 'RETRY_FAILED', liquidityBalance:providerAccount?.available_balance });
        transaction = await d1First(database, 'SELECT * FROM payment_gateway_transactions WHERE id=? LIMIT 1', [transactionId]);
        await d1Batch(database, [auditOperation(organizationId, authorization.actor, action === 'RETRY_FAILED' ? 'E2PAY_FAILED_ITEMS_RETRIED' : 'E2PAY_EXECUTION',
          `${result.parentStatus || result.code || 'UNKNOWN'} · ${result.summary?.succeeded || 0}/${result.summary?.total || beneficiaries.length}`, payment.id)]);
        return secureJson({ ...result, transaction:publicTransaction(transaction), gateway:readiness }, result.statusCode, request, env, METHODS);
      } catch (error) {
        const unresolved = await d1First(database, `SELECT COUNT(*) AS count FROM payment_gateway_items
          WHERE payment_gateway_transaction_id=? AND status IN ('PENDING','PROCESSING','UNKNOWN')`, [transactionId]);
        const hasUnresolved = Number(unresolved?.count || 0) > 0;
        await d1Batch(database, [
          { statement: `UPDATE payment_gateway_transactions SET status=?,provider_status=?,error_code=?,error_message=?,updated_at=${NOW} WHERE id=?`,
            bindings: [
              hasUnresolved ? 'PROCESSING' : 'FAILED',
              hasUnresolved ? 'AWAITING_RECONCILIATION' : 'FAILED',
              hasUnresolved ? 'E2PAY_EXECUTION_UNKNOWN' : 'E2PAY_EXECUTION_FAILED',
              String(error?.message || error).slice(0, 500),
              transactionId,
            ] },
          auditOperation(organizationId,authorization.actor,hasUnresolved ? 'E2PAY_EXECUTION_UNCERTAIN' : 'E2PAY_EXECUTION_FAILED',
            String(error?.message || error).slice(0,500),payment.id),
        ]);
        return secureJson({
          error:hasUnresolved
            ? 'Status provider belum pasti. Lakukan reconciliation sebelum retry.'
            : 'Eksekusi E2Pay gagal sebelum provider menerima transaksi.',
          code:hasUnresolved ? 'E2PAY_EXECUTION_UNKNOWN' : 'E2PAY_EXECUTION_FAILED',
          transactionId,
        }, hasUnresolved ? 409 : 502, request, env, METHODS);
      } finally {
        await releaseExecutionLease(database, transactionId, leaseToken);
      }
    }

    try {
      const providerResult = await createGatewayPayment(runtimeEnv, {
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
      return secureJson({ ok: true, transaction:publicTransaction(transaction), gateway: readiness }, 201, request, env, METHODS);
    } catch (error) {
      const configurationFailure = error instanceof PaymentGatewayConfigurationError;
      const nextStatus = configurationFailure ? 'FAILED' : 'PROCESSING';
      const errorCode = configurationFailure ? 'GATEWAY_CONFIGURATION' : 'GATEWAY_EXECUTION_UNKNOWN';
      await d1Batch(database, [
        { statement: `UPDATE payment_gateway_transactions SET status=?,provider_status=?,error_code=?,error_message=?,updated_at=${NOW} WHERE id=?`,
          bindings: [nextStatus,configurationFailure ? 'FAILED' : 'AWAITING_PROVIDER_CONFIRMATION',errorCode,String(error?.message || error).slice(0,500),transactionId] },
        auditOperation(organizationId,authorization.actor,configurationFailure ? 'GATEWAY_EXECUTION_FAILED' : 'GATEWAY_EXECUTION_UNCERTAIN',
          String(error?.message || error).slice(0,500),payment.id),
      ]);
      return secureJson({
        error:configurationFailure
          ? 'Konfigurasi payment gateway tidak valid.'
          : 'Hasil eksekusi gateway belum pasti. Jangan retry sampai status provider dikonfirmasi.',
        code:errorCode,
        transactionId,
        requiresProviderConfirmation:!configurationFailure,
      }, configurationFailure ? 503 : 409, request, env, METHODS);
    }
  } catch (error) {
    const requestId = crypto.randomUUID();
    const detail = publicError(error, requestId);
    return secureJson(detail, error?.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500, request, env, METHODS);
  }
}
