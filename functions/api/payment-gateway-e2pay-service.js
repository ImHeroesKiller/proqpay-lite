import { d1All, d1Batch } from './_d1.js';
import {
  E2PayRequestError,
  e2payAuthorize,
  e2payBankList,
  e2payClientRef,
  e2payDisburse,
  e2payInquiry,
  e2payMerchantAccount,
  e2payResponseStatus,
  e2paySyncBeneficiaryLimit,
  e2payTransactionHistory,
  resolveE2PayBank,
} from './payment-gateway-e2pay.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemStatusCounts(items) {
  const counts = {};
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

export function summarizeE2PayItems(items = []) {
  const counts = itemStatusCounts(items);
  const amount = items.reduce((sum, item) => sum + number(item.amount), 0);
  const fees = items.reduce((sum, item) => sum + number(item.fee_amount), 0);
  return {
    total: items.length,
    amount,
    fees,
    requiredBalance: amount + fees,
    counts,
    succeeded: counts.SUCCEEDED || 0,
    processing: (counts.PROCESSING || 0) + (counts.PENDING || 0) + (counts.UNKNOWN || 0),
    failed: counts.FAILED || 0,
    ready: (counts.CREATED || 0) + (counts.INQUIRY_READY || 0),
  };
}

async function loadItems(database, transactionId) {
  return d1All(database,
    'SELECT * FROM payment_gateway_items WHERE payment_gateway_transaction_id=? ORDER BY created_at,id',
    [transactionId]);
}

async function ensureItems(database, transactionId, payment, beneficiaries) {
  const existing = await loadItems(database, transactionId);
  const existingLines = new Set(existing.map((item) => item.payment_instruction_line_id));
  const operations = [];
  for (const beneficiary of beneficiaries) {
    if (existingLines.has(beneficiary.id)) continue;
    const clientRef = await e2payClientRef(payment, beneficiary);
    operations.push({
      statement: 'INSERT OR IGNORE INTO payment_gateway_items ' +
        '(id,payment_gateway_transaction_id,payment_instruction_line_id,employee_id,provider,client_ref,beneficiary_name,account_last4,amount,status) ' +
        "VALUES(?,?,?,?,?,?,?,?,?,'CREATED')",
      bindings: [
        'PGI-' + crypto.randomUUID(),
        transactionId,
        beneficiary.id,
        beneficiary.employeeId || null,
        'E2PAY',
        clientRef,
        beneficiary.beneficiaryName,
        String(beneficiary.accountNumber || '').slice(-4),
        Number(beneficiary.amount),
      ],
    });
  }
  for (let offset = 0; offset < operations.length; offset += 50) {
    await d1Batch(database, operations.slice(offset, offset + 50));
  }
  return loadItems(database, transactionId);
}

function beneficiaryMap(beneficiaries) {
  return new Map(beneficiaries.map((row) => [row.id, row]));
}

export function isRetryableE2PayFailure(item) {
  if (String(item?.status || '') !== 'FAILED') return false;
  if (Number(item?.attempt_count || 0) === 0) return true;
  return String(item?.response_code || '').trim() === '99';
}

async function updateItem(database, itemId, fields) {
  const names = Object.keys(fields);
  if (!names.length) return;
  const sql = names.map((name) => name + '=?').join(',');
  await d1Batch(database, [{
    statement: 'UPDATE payment_gateway_items SET ' + sql + ',updated_at=' + NOW + ' WHERE id=?',
    bindings: [...names.map((name) => fields[name]), itemId],
  }]);
}

async function updateParent(database, transactionId, fields) {
  const names = Object.keys(fields);
  if (!names.length) return;
  const sql = names.map((name) => name + '=?').join(',');
  await d1Batch(database, [{
    statement: 'UPDATE payment_gateway_transactions SET ' + sql + ',updated_at=' + NOW + ' WHERE id=?',
    bindings: [...names.map((name) => fields[name]), transactionId],
  }]);
}

async function transitionPaymentState(database, payment, parentStatus, summary) {
  if (parentStatus === 'SUCCEEDED') {
    await d1Batch(database, [
      { statement: "UPDATE payment_instructions SET status='RECONCILIATION',updated_at=" + NOW +
          " WHERE id=? AND status IN ('APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING')", bindings:[payment.id] },
      { statement: "UPDATE payroll_submissions SET state='RECONCILIATION',updated_at=" + NOW +
          " WHERE id=? AND state IN ('APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING')", bindings:[payment.submission_id] },
    ]);
    return;
  }

  const providerActivity = summary.succeeded > 0 || summary.processing > 0
    || (summary.total - summary.ready - summary.failed) > 0;
  if (providerActivity || summary.ready > 0) {
    await d1Batch(database, [
      { statement: "UPDATE payment_instructions SET status='DISBURSEMENT_PROCESSING',updated_at=" + NOW +
          " WHERE id=? AND status IN ('APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING')", bindings:[payment.id] },
      { statement: "UPDATE payroll_submissions SET state='DISBURSEMENT_PROCESSING',updated_at=" + NOW +
          " WHERE id=? AND state IN ('APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING')", bindings:[payment.submission_id] },
    ]);
  }
}

async function prepareBeneficiaries(database, env, transactionId, payment, beneficiaries, accessToken, banks, { retryFailed = false } = {}) {
  let items = await ensureItems(database, transactionId, payment, beneficiaries);
  const byLine = beneficiaryMap(beneficiaries);

  for (const item of items) {
    const beneficiary = byLine.get(item.payment_instruction_line_id);
    // A continuation call intentionally passes only the bounded beneficiary chunk.
    // Items outside the chunk stay untouched for the next request.
    if (!beneficiary) continue;
    if (['SUCCEEDED','PROCESSING','PENDING','UNKNOWN','INQUIRY_READY'].includes(item.status)) continue;
    if (item.status === 'FAILED' && Number(item.attempt_count || 0) > 0
      && !(retryFailed && isRetryableE2PayFailure(item))) continue;

    const bank = resolveE2PayBank(banks, beneficiary);
    if (!bank) {
      await updateItem(database, item.id, {
        status:'FAILED',
        error_code:'E2PAY_BANK_NOT_MAPPED',
        error_message:'Bank ' + (beneficiary.bankCode || beneficiary.bankName || '-') + ' tidak ditemukan pada directory E2Pay',
      });
      continue;
    }

    try {
      const inquiry = await e2payInquiry(env, accessToken, {
        accountId:beneficiary.accountNumber,
        bankId:bank.id,
        amount:beneficiary.amount,
      });
      const returnedAccount = String(inquiry?.accountId || '').trim();
      const returnedAmount = Math.trunc(number(inquiry?.amount));
      const inquiryId = String(inquiry?.id || '').trim();
      if (!inquiryId || returnedAccount !== String(beneficiary.accountNumber || '').trim() || returnedAmount !== Number(beneficiary.amount)) {
        await updateItem(database, item.id, {
          status:'FAILED',
          bank_id:String(bank.id),
          error_code:'E2PAY_INQUIRY_CONTROL_MISMATCH',
          error_message:'Hasil inquiry tidak sesuai beneficiary snapshot',
        });
        continue;
      }
      await updateItem(database, item.id, {
        status:'INQUIRY_READY',
        bank_id:String(bank.id),
        provider_beneficiary_name:String(inquiry?.name || '').slice(0, 180) || null,
        inquiry_id:inquiryId,
        fee_amount:Math.max(0, Math.trunc(number(inquiry?.feeAmount))),
        response_code:null,
        response_message:null,
        error_code:null,
        error_message:null,
      });
    } catch (error) {
      await updateItem(database, item.id, {
        status:'FAILED',
        bank_id:String(bank.id),
        response_code:null,
        response_message:null,
        error_code:error instanceof E2PayRequestError ? error.code : 'E2PAY_INQUIRY_FAILED',
        error_message:String(error?.message || 'Inquiry E2Pay gagal').slice(0, 300),
      });
    }
  }
  items = await loadItems(database, transactionId);
  return items;
}

function parentOutcome(items) {
  const summary = summarizeE2PayItems(items);
  if (summary.total > 0 && summary.succeeded === summary.total) return { status:'SUCCEEDED', summary };
  if (summary.succeeded > 0 || summary.processing > 0 || summary.ready > 0) return { status:'PROCESSING', summary };
  return { status:'FAILED', summary };
}

export function selectE2PayExecutionChunk(items = [], limit = 25, retryFailed = false) {
  const bounded = Math.max(1, Math.min(100, Number(limit) || 25));
  const eligible = retryFailed
    ? items.filter((item) => isRetryableE2PayFailure(item))
    : items.filter((item) => item.status === 'CREATED'
      || (item.status === 'INQUIRY_READY' && Number(item.attempt_count || 0) === 0));
  return eligible.slice(0, bounded);
}

export async function executeE2PayBatch({ database, env, transactionId, payment, beneficiaries, retryFailed = false }) {
  const limit = e2paySyncBeneficiaryLimit(env);
  let allItems = await ensureItems(database, transactionId, payment, beneficiaries);

  const unresolved = allItems.filter((item) => ['PENDING','PROCESSING','UNKNOWN'].includes(item.status));
  if (unresolved.length) {
    const outcome = parentOutcome(allItems);
    const remaining = allItems.filter((item) => item.status === 'CREATED'
      || (item.status === 'INQUIRY_READY' && Number(item.attempt_count || 0) === 0)).length;
    await updateParent(database, transactionId, {
      status:'PROCESSING',
      provider_status:'AWAITING_RECONCILIATION',
      error_code:null,
      error_message:null,
    });
    await transitionPaymentState(database, payment, 'PROCESSING', outcome.summary);
    return {
      ok:true,
      statusCode:200,
      summary:outcome.summary,
      items:allItems,
      parentStatus:'PROCESSING',
      hasMore:false,
      remaining,
      processedThisCall:0,
      blockedByUnresolved:true,
    };
  }

  const auth = await e2payAuthorize(env);
  const [merchant, banks] = await Promise.all([
    e2payMerchantAccount(env, auth.accessToken),
    e2payBankList(env, auth.accessToken),
  ]);
  const merchantBalance = number(merchant?.balance);

  // Phase 1: finish beneficiary inquiry/preflight for the full immutable PI before
  // the first financial POST. This may span multiple Worker requests, but every
  // successful inquiry is durable and the UI can safely continue the next chunk.
  const preflightCandidates = retryFailed
    ? allItems.filter((item) => isRetryableE2PayFailure(item))
    : allItems.filter((item) => item.status === 'CREATED');

  if (preflightCandidates.length) {
    const preflightChunk = preflightCandidates.slice(0, limit);
    const chunkLineIds = new Set(preflightChunk.map((item) => item.payment_instruction_line_id));
    const chunkBeneficiaries = beneficiaries.filter((row) => chunkLineIds.has(row.id));
    allItems = await prepareBeneficiaries(
      database,
      env,
      transactionId,
      payment,
      chunkBeneficiaries,
      auth.accessToken,
      banks,
      { retryFailed },
    );

    const preflightSummary = summarizeE2PayItems(allItems);
    const providerActivity = preflightSummary.succeeded > 0 || preflightSummary.processing > 0;
    if (preflightSummary.failed > 0 && !providerActivity) {
      await updateParent(database, transactionId, {
        status:'FAILED',
        provider_status:'PREFLIGHT_FAILED',
        error_code:'E2PAY_PREFLIGHT_FAILED',
        error_message:preflightSummary.failed + ' beneficiary gagal preflight E2Pay',
      });
      return {
        ok:false,
        statusCode:409,
        code:'E2PAY_PREFLIGHT_FAILED',
        error:'Preflight seluruh beneficiary harus lolos sebelum disbursement pertama',
        merchantBalance,
        summary:preflightSummary,
        items:allItems,
        parentStatus:'FAILED',
        hasMore:false,
        remaining:allItems.filter((item) => item.status === 'CREATED').length,
        preflightOnly:true,
        processedThisCall:0,
      };
    }

    const remainingPreflight = retryFailed
      ? allItems.filter((item) => isRetryableE2PayFailure(item)).length
      : allItems.filter((item) => item.status === 'CREATED').length;
    if (remainingPreflight > 0) {
      await updateParent(database, transactionId, {
        status:'CREATED',
        provider_status:'PREFLIGHT',
        error_code:null,
        error_message:null,
      });
      return {
        ok:true,
        statusCode:200,
        summary:preflightSummary,
        items:allItems,
        parentStatus:'CREATED',
        hasMore:true,
        remaining:remainingPreflight,
        preflightOnly:true,
        processedThisCall:0,
        chunkLimit:limit,
      };
    }
  }

  let summary = summarizeE2PayItems(allItems);
  const providerActivity = summary.succeeded > 0 || summary.processing > 0;

  // A non-retryable preflight failure must also block the first money movement.
  if (summary.failed > 0 && !providerActivity) {
    await updateParent(database, transactionId, {
      status:'FAILED',
      provider_status:'PREFLIGHT_FAILED',
      error_code:'E2PAY_PREFLIGHT_FAILED',
      error_message:summary.failed + ' beneficiary gagal preflight E2Pay',
    });
    return {
      ok:false,
      statusCode:409,
      code:'E2PAY_PREFLIGHT_FAILED',
      error:'Preflight seluruh beneficiary harus lolos sebelum disbursement pertama',
      merchantBalance,
      summary,
      items:allItems,
      parentStatus:'FAILED',
      hasMore:false,
      remaining:0,
      preflightOnly:true,
      processedThisCall:0,
    };
  }

  // Phase 2: all not-yet-paid beneficiaries must already have a durable inquiry.
  // Check the full remaining payroll + fees before the first disbursement.
  const remainingRequired = allItems
    .filter((item) => item.status === 'INQUIRY_READY')
    .reduce((sum, item) => sum + number(item.amount) + number(item.fee_amount), 0);
  if (!providerActivity && merchantBalance < remainingRequired) {
    await updateParent(database, transactionId, {
      status:'FAILED',
      provider_status:'INSUFFICIENT_BALANCE',
      error_code:'E2PAY_INSUFFICIENT_BALANCE',
      error_message:'Balance ' + merchantBalance + ' < required ' + remainingRequired,
    });
    return {
      ok:false,
      statusCode:409,
      code:'E2PAY_INSUFFICIENT_BALANCE',
      error:'Saldo merchant E2Pay tidak mencukupi untuk seluruh beneficiary yang siap dibayar',
      merchantBalance,
      requiredBalance:remainingRequired,
      summary,
      items:allItems,
    };
  }

  const paymentChunk = allItems
    .filter((item) => item.status === 'INQUIRY_READY' && Number(item.attempt_count || 0) === 0)
    .slice(0, limit);

  if (!paymentChunk.length) {
    const outcome = parentOutcome(allItems);
    await updateParent(database, transactionId, {
      status:outcome.status,
      provider_status:outcome.status,
    });
    await transitionPaymentState(database, payment, outcome.status, outcome.summary);
    return {
      ok:true,
      statusCode:200,
      summary:outcome.summary,
      items:allItems,
      parentStatus:outcome.status,
      hasMore:false,
      processedThisCall:0,
    };
  }

  const paymentLineIds = new Set(paymentChunk.map((item) => item.payment_instruction_line_id));
  const paymentBeneficiaries = beneficiaries.filter((row) => paymentLineIds.has(row.id));
  const byLine = beneficiaryMap(paymentBeneficiaries);

  for (const item of paymentChunk) {
    const beneficiary = byLine.get(item.payment_instruction_line_id);
    if (!beneficiary) continue;

    // Durable pre-call marker: once this succeeds, any subsequent uncertainty is
    // reconciled by clientRef and never treated as safe for blind retry.
    await updateItem(database, item.id, {
      attempt_count:Number(item.attempt_count || 0) + 1,
      status:'PENDING',
    });

    let result;
    try {
      result = await e2payDisburse(env, auth.accessToken, {
        clientRef:item.client_ref,
        description:(payment.document_no || payment.id) + ' · ' + beneficiary.beneficiaryName,
        inquiryId:item.inquiry_id,
      });
    } catch (error) {
      const ambiguous = error instanceof E2PayRequestError && (['E2PAY_TIMEOUT','E2PAY_NETWORK_ERROR'].includes(error.code)
        || (error.code === 'E2PAY_HTTP_ERROR' && (Number(error.httpStatus) >= 500 || [408,429].includes(Number(error.httpStatus)))));
      await updateItem(database, item.id, {
        status:ambiguous ? 'UNKNOWN' : 'FAILED',
        last_checked_at:new Date().toISOString(),
        error_code:error instanceof E2PayRequestError ? error.code : 'E2PAY_TRANSACTION_FAILED',
        error_message:String(error?.message || 'Transaksi E2Pay gagal').slice(0, 300),
      });
      if (ambiguous) break;
      continue;
    }

    const providerStatus = e2payResponseStatus(result?.responseCode);
    const itemStatus = providerStatus === 'PENDING' ? 'UNKNOWN' : providerStatus;
    try {
      await updateItem(database, item.id, {
        status:itemStatus,
        provider_transaction_id:String(result?.journalId || '') || null,
        journal_id:String(result?.journalId || '') || null,
        correlation_id:String(result?.correlationId || '') || null,
        response_code:String(result?.responseCode ?? ''),
        response_message:String(result?.responseMessage || '').slice(0, 300) || null,
        last_checked_at:new Date().toISOString(),
        error_code:itemStatus === 'FAILED' ? 'E2PAY_PROVIDER_REJECTED' : null,
        error_message:itemStatus === 'FAILED' ? String(result?.responseMessage || 'E2Pay transaction failed').slice(0, 300) : null,
      });
    } catch {
      try {
        await updateItem(database, item.id, {
          status:'UNKNOWN',
          last_checked_at:new Date().toISOString(),
          error_code:'E2PAY_RESULT_PERSISTENCE_UNKNOWN',
          error_message:'Provider merespons tetapi hasil belum dapat dipersist; wajib reconcile sebelum retry',
        });
      } catch {
        // PENDING remains durable and blocks a blind retry.
      }
      break;
    }
  }

  allItems = await loadItems(database, transactionId);
  const outcome = parentOutcome(allItems);
  summary = outcome.summary;
  const partialFailure = summary.failed > 0 && (summary.succeeded > 0 || summary.processing > 0);
  await updateParent(database, transactionId, {
    status:outcome.status,
    provider_status:outcome.status,
    error_code:partialFailure ? 'E2PAY_PARTIAL_FAILURE' : null,
    error_message:partialFailure ? summary.failed + ' beneficiary gagal; jangan retry seluruh PI' : null,
  });
  if (outcome.status === 'SUCCEEDED') {
    await d1Batch(database, [{
      statement:'UPDATE payment_gateway_transactions SET paid_at=' + NOW + ' WHERE id=?',
      bindings:[transactionId],
    }]);
  }
  await transitionPaymentState(database, payment, outcome.status, summary);

  const remaining = allItems.filter((item) => item.status === 'INQUIRY_READY'
    && Number(item.attempt_count || 0) === 0).length;
  return {
    ok:true,
    statusCode:201,
    merchantBalance,
    summary,
    items:allItems,
    parentStatus:outcome.status,
    hasMore:remaining > 0,
    remaining,
    processedThisCall:paymentBeneficiaries.length,
    chunkLimit:limit,
  };
}

export async function reconcileE2PayBatch({ database, env, transactionId, payment }) {
  const auth = await e2payAuthorize(env);
  let items = await loadItems(database, transactionId);
  for (const item of items) {
    if (!['PROCESSING','PENDING','UNKNOWN'].includes(item.status)) continue;
    try {
      const history = await e2payTransactionHistory(env, auth.accessToken, item.client_ref);
      if (!history) {
        await updateItem(database, item.id, { last_checked_at:new Date().toISOString() });
        continue;
      }
      const normalized = e2payResponseStatus(history.responseCode);
      const status = normalized === 'PENDING' ? 'UNKNOWN' : normalized;
      await updateItem(database, item.id, {
        status,
        provider_transaction_id:String(history?.journalId || item.provider_transaction_id || '') || null,
        journal_id:String(history?.journalId || item.journal_id || '') || null,
        response_code:String(history?.responseCode ?? ''),
        response_message:String(history?.responseMessage || '').slice(0, 300) || null,
        last_checked_at:new Date().toISOString(),
        error_code:status === 'FAILED' ? 'E2PAY_PROVIDER_REJECTED' : null,
        error_message:status === 'FAILED' ? String(history?.responseMessage || 'E2Pay transaction failed').slice(0, 300) : null,
      });
    } catch (error) {
      await updateItem(database, item.id, {
        last_checked_at:new Date().toISOString(),
        error_code:error instanceof E2PayRequestError ? error.code : 'E2PAY_HISTORY_FAILED',
        error_message:String(error?.message || 'Rekonsiliasi E2Pay gagal').slice(0, 300),
      });
    }
  }

  items = await loadItems(database, transactionId);
  const outcome = parentOutcome(items);
  const partialFailure = outcome.summary.failed > 0 &&
    (outcome.summary.succeeded > 0 || outcome.summary.processing > 0 || outcome.summary.ready > 0);
  await updateParent(database, transactionId, {
    status:outcome.status,
    provider_status:outcome.status,
    error_code:partialFailure ? 'E2PAY_PARTIAL_FAILURE' : null,
    error_message:partialFailure ? outcome.summary.failed + ' beneficiary gagal; review diperlukan' : null,
  });
  if (outcome.status === 'SUCCEEDED') {
    await d1Batch(database, [{
      statement:'UPDATE payment_gateway_transactions SET paid_at=COALESCE(paid_at,' + NOW + ') WHERE id=?',
      bindings:[transactionId],
    }]);
  }
  await transitionPaymentState(database, payment, outcome.status, outcome.summary);
  return { ok:true, statusCode:200, summary:outcome.summary, items, parentStatus:outcome.status };
}
