import { d1Batch, d1First, hasD1 } from './_d1.js';
import { markEwaRepaid } from './_ewa.js';
import { sha256Hex } from './payment-instruction-core.js';
import { PaymentGatewayConfigurationError, parseGatewayWebhook } from './payment-gateway-core.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const TERMINAL_FAILURES = new Set(['FAILED','EXPIRED','CANCELLED']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function auditOperation(transaction, action, detail) {
  return {
    statement: `INSERT INTO audit_logs (id,org_id,username,role,action,detail,entity,entity_id)
      VALUES (?,?,?,?,?,?,?,?)`,
    bindings: [`AUD-${crypto.randomUUID()}`, transaction.org_id, `gateway:${transaction.provider.toLowerCase()}`, 'SYSTEM',
      action, detail, 'payment_instruction', transaction.payment_instruction_id],
  };
}

function hostedStatusOperation(transactionId, status) {
  return {
    statement: `UPDATE hosted_payment_sessions SET status=?,
      completed_at=CASE WHEN ?='COMPLETED' THEN ${NOW} ELSE completed_at END,
      checkout_url=CASE WHEN ? IN ('COMPLETED','FAILED','EXPIRED','CANCELLED') THEN NULL ELSE checkout_url END,
      updated_at=${NOW}
      WHERE payment_gateway_transaction_id=? AND status NOT IN ('COMPLETED','CANCELLED','FAILED','EXPIRED')`,
    bindings: [status, status, status, transactionId],
  };
}

async function markEwaRepaidSafe(database, submissionId) {
  try { await markEwaRepaid(database, submissionId); }
  catch (error) {
    if (!/no such table|no such column/i.test(String(error?.message || error))) throw error;
  }
}

async function registerWebhookEvent(database, transaction, event, payloadHash) {
  let eventId = `PGE-${crypto.randomUUID()}`;
  try {
    await d1Batch(database, [{
      statement: `INSERT INTO payment_gateway_events
        (id,payment_gateway_transaction_id,provider,provider_event_id,event_type,signature_valid,payload_hash,payload_json,status)
        VALUES (?,?,?,?,?,1,?,?,'RECEIVED')`,
      bindings: [eventId, transaction.id, event.provider, event.eventId, event.eventType, payloadHash, JSON.stringify(event.safePayload)],
    }]);
    return { eventId, resumed:false };
  } catch (error) {
    if (!/UNIQUE constraint failed/i.test(String(error?.message || error))) throw error;
    const existing = await d1First(database, `SELECT id,payment_gateway_transaction_id,payload_hash,status
      FROM payment_gateway_events WHERE provider=? AND provider_event_id=? LIMIT 1`, [event.provider,event.eventId]);
    if (!existing) throw error;
    if (existing.payment_gateway_transaction_id !== transaction.id || existing.payload_hash !== payloadHash) {
      return { response:json({ error:'Webhook replay payload mismatch',code:'PAYMENT_GATEWAY_EVENT_REPLAY_MISMATCH' },409) };
    }
    if (['PROCESSED','IGNORED'].includes(existing.status)) {
      return { response:json({ ok:true,duplicate:true,status:existing.status }) };
    }
    eventId = existing.id;
    await d1Batch(database,[{
      statement:`UPDATE payment_gateway_events SET status='RECEIVED',processed_at=NULL WHERE id=?`,bindings:[eventId],
    }]);
    return { eventId, resumed:true };
  }
}

async function ignoreEvent(database, eventId, reason) {
  await d1Batch(database,[{
    statement:`UPDATE payment_gateway_events SET status='IGNORED',processed_at=${NOW},payload_json=json_set(payload_json,'$.proqpayIgnoreReason',?) WHERE id=?`,
    bindings:[reason,eventId],
  }]);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!hasD1(env)) return json({ error: 'Cloudflare D1 binding unavailable', code: 'D1_REQUIRED' }, 503);
  if (Number(request.headers.get('content-length') || 0) > 128 * 1024) return json({ error: 'Payload too large' }, 413);

  const rawBody = await request.text();
  try {
    const event = await parseGatewayWebhook(env, rawBody, request.headers);
    if (!event.signatureValid) return json({ error: 'Invalid webhook signature' }, 401);

    const transaction = await d1First(env.DB, `SELECT pgt.*,pi.submission_id,pi.expected_total,pi.content_hash,
      COALESCE((SELECT SUM(pil.amount) FROM payment_instruction_lines pil WHERE pil.payment_instruction_id=pi.id),0) AS instruction_total
      FROM payment_gateway_transactions pgt JOIN payment_instructions pi ON pi.id=pgt.payment_instruction_id
      WHERE pgt.provider=? AND pgt.provider_transaction_id=? LIMIT 1`, [event.provider, event.providerTransactionId]);
    if (!transaction) return json({ error: 'Gateway transaction not found' }, 404);

    const payloadHash = await sha256Hex(rawBody);
    const registration = await registerWebhookEvent(env.DB, transaction, event, payloadHash);
    if (registration.response) return registration.response;
    const eventId = registration.eventId;

    // Success is monotonic. Once money movement is confirmed, a late FAILED/CANCELLED/PENDING
    // callback must never regress PI, payroll, reconciliation, or EWA state.
    if (transaction.status === 'SUCCEEDED') {
      if (event.status === 'SUCCEEDED') {
        await markEwaRepaidSafe(env.DB, transaction.submission_id);
        await d1Batch(env.DB,[{ statement:`UPDATE payment_gateway_events SET status='PROCESSED',processed_at=${NOW} WHERE id=?`,bindings:[eventId] }]);
        return json({ ok:true,status:'COMPLETED',replayedSuccess:true });
      }
      await ignoreEvent(env.DB,eventId,`transaction already SUCCEEDED; late ${event.status} ignored`);
      return json({ ok:true,status:'COMPLETED',ignored:true });
    }

    // Do not revive a provider terminal failure with an older pending/processing callback.
    // A later signed SUCCEEDED event is still allowed to recover the transaction.
    if (TERMINAL_FAILURES.has(transaction.status) && event.status !== 'SUCCEEDED') {
      await ignoreEvent(env.DB,eventId,`transaction already ${transaction.status}; late ${event.status} ignored`);
      return json({ ok:true,status:'PAYMENT_EXCEPTION',ignored:true });
    }

    const amountMatches = Number(event.amount) === Number(transaction.amount)
      && Number(transaction.amount) === Number(transaction.expected_total)
      && Number(transaction.instruction_total) === Number(transaction.expected_total);
    const currencyMatches = String(event.currency || '').toUpperCase() === String(transaction.currency || 'IDR').toUpperCase();
    if (!amountMatches || !currencyMatches) {
      await d1Batch(env.DB, [
        { statement: `UPDATE payment_gateway_transactions SET status='FAILED',provider_status=?,error_code='WEBHOOK_CONTROL_MISMATCH',
            error_message='Webhook amount/currency does not match immutable PI',updated_at=${NOW} WHERE id=?`, bindings: [event.providerStatus, transaction.id] },
        hostedStatusOperation(transaction.id, 'FAILED'),
        { statement: `UPDATE payment_gateway_events SET status='FAILED',processed_at=${NOW} WHERE id=?`, bindings: [eventId] },
        { statement: `UPDATE payment_instructions SET status='PAYMENT_EXCEPTION',updated_at=${NOW} WHERE id=?`, bindings: [transaction.payment_instruction_id] },
        { statement: `UPDATE payroll_submissions SET state='PAYMENT_EXCEPTION',updated_at=${NOW} WHERE id=?`, bindings: [transaction.submission_id] },
        auditOperation(transaction, 'GATEWAY_PAYMENT_CONTROL_MISMATCH', `${event.provider} webhook ditolak karena nominal/currency tidak sesuai PI`),
      ]);
      return json({ error: 'Webhook control total mismatch', code: 'PAYMENT_GATEWAY_CONTROL_MISMATCH' }, 409);
    }

    if (event.status === 'SUCCEEDED') {
      const difference = Number(event.amount) - Number(transaction.expected_total);
      // Keep the event RECEIVED until EWA repayment is also committed. If an auxiliary
      // step fails, the provider can safely replay the exact same event and resume.
      await d1Batch(env.DB, [
        { statement: `UPDATE payment_gateway_transactions SET status='SUCCEEDED',provider_status=?,paid_at=COALESCE(paid_at,${NOW}),updated_at=${NOW},
            error_code=NULL,error_message=NULL WHERE id=?`, bindings: [event.providerStatus, transaction.id] },
        hostedStatusOperation(transaction.id, 'COMPLETED'),
        { statement: `INSERT INTO reconciliations
            (id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status,reviewed_by)
            VALUES (?,?,?,?,?,?,'MATCHED',?)
            ON CONFLICT(payment_instruction_id) DO UPDATE SET expected_total=excluded.expected_total,
              instruction_total=excluded.instruction_total,proof_total=excluded.proof_total,difference=excluded.difference,
              status='MATCHED',reviewed_by=excluded.reviewed_by,created_at=${NOW}`,
          bindings: [`REC-${crypto.randomUUID()}`, transaction.payment_instruction_id, transaction.expected_total,
            transaction.instruction_total, event.amount, difference, `gateway:${event.provider.toLowerCase()}`] },
        { statement: `UPDATE payment_instructions SET status='COMPLETED',updated_at=${NOW} WHERE id=?`, bindings: [transaction.payment_instruction_id] },
        { statement: `UPDATE payroll_submissions SET state='COMPLETED',updated_at=${NOW} WHERE id=?`, bindings: [transaction.submission_id] },
        auditOperation(transaction, 'GATEWAY_PAYMENT_COMPLETED', `${event.provider} · ${transaction.provider_transaction_id} · MATCHED`),
      ]);
      await markEwaRepaidSafe(env.DB, transaction.submission_id);
      await d1Batch(env.DB,[{ statement:`UPDATE payment_gateway_events SET status='PROCESSED',processed_at=${NOW} WHERE id=?`,bindings:[eventId] }]);
      return json({ ok: true, status: 'COMPLETED' });
    }

    if (TERMINAL_FAILURES.has(event.status)) {
      await d1Batch(env.DB, [
        { statement: `UPDATE payment_gateway_transactions SET status=?,provider_status=?,error_code='PROVIDER_TERMINAL_STATUS',
            error_message=?,updated_at=${NOW} WHERE id=?`, bindings: [event.status, event.providerStatus, `Provider status: ${event.providerStatus}`, transaction.id] },
        hostedStatusOperation(transaction.id, event.status),
        { statement: `UPDATE payment_instructions SET status='PAYMENT_EXCEPTION',updated_at=${NOW} WHERE id=?`, bindings: [transaction.payment_instruction_id] },
        { statement: `UPDATE payroll_submissions SET state='PAYMENT_EXCEPTION',updated_at=${NOW} WHERE id=?`, bindings: [transaction.submission_id] },
        { statement: `UPDATE payment_gateway_events SET status='PROCESSED',processed_at=${NOW} WHERE id=?`, bindings: [eventId] },
        auditOperation(transaction, 'GATEWAY_PAYMENT_EXCEPTION', `${event.provider} · ${event.status} · ${transaction.provider_transaction_id}`),
      ]);
      return json({ ok: true, status: 'PAYMENT_EXCEPTION' });
    }

    await d1Batch(env.DB, [
      { statement: `UPDATE payment_gateway_transactions SET status=?,provider_status=?,updated_at=${NOW} WHERE id=?`, bindings: [event.status, event.providerStatus, transaction.id] },
      hostedStatusOperation(transaction.id, 'OPENED'),
      { statement: `UPDATE payment_instructions SET status='DISBURSEMENT_PROCESSING',updated_at=${NOW} WHERE id=?`, bindings: [transaction.payment_instruction_id] },
      { statement: `UPDATE payroll_submissions SET state='DISBURSEMENT_PROCESSING',updated_at=${NOW} WHERE id=?`, bindings: [transaction.submission_id] },
      { statement: `UPDATE payment_gateway_events SET status='PROCESSED',processed_at=${NOW} WHERE id=?`, bindings: [eventId] },
    ]);
    return json({ ok: true, status: 'DISBURSEMENT_PROCESSING' });
  } catch (error) {
    if (error instanceof PaymentGatewayConfigurationError) return json({ error: error.message, code: 'PAYMENT_GATEWAY_NOT_READY' }, 503);
    console.error(JSON.stringify({ level: 'error', area: 'payment-gateway-webhook', message: String(error?.message || error) }));
    return json({ error: 'Webhook processing failed' }, 500);
  }
}
