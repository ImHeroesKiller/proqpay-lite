// Explicit fields only: never export credentials, raw diagnostics or bank accounts.
export function buildE2PaySupportEvidence(request, execution, items = []) {
  if (!request?.id || !execution?.id || execution.disbursement_request_id !== request.id) {
    throw new Error('Execution tidak cocok dengan Disbursement Request.');
  }
  const recipients = items.map(item => {
    if (item.disbursement_execution_id !== execution.id) throw new Error('Item execution tidak cocok.');
    return {
      clientRef: item.client_ref ?? null,
      bankId: item.bank_id ?? null,
      accountLast4: item.account_last4 ?? null,
      amount: Number(item.amount || 0),
      feeAmount: Number(item.fee_amount || 0),
      status: item.status ?? null,
      inquiryId: item.inquiry_id ?? null,
      providerTransactionId: item.provider_transaction_id ?? null,
      journalId: item.journal_id ?? null,
      responseCode: item.response_code ?? null,
      responseMessage: item.response_message ?? null,
      errorCode: item.error_code ?? null,
      errorMessage: item.error_message ?? null,
      failureStage: item.failure_stage ?? null,
      attemptCount: Number(item.attempt_count || 0),
      lastAttemptAt: item.last_attempt_at ?? null,
      lastCheckedAt: item.last_checked_at ?? null,
      updatedAt: item.updated_at ?? null,
    };
  });
  return {
    schemaVersion: 1,
    evidenceType: 'STORED_EXECUTION_SUMMARY',
    note: 'Ringkasan dari ledger tersimpan; bukan raw HTTP request/response E2Pay. Waktu menggunakan UTC (Z).',
    provider: request.provider,
    environment: request.environment,
    clientReference: request.clientReference,
    disbursementRequestId: request.id,
    sourceDocumentType: request.sourceDocumentType,
    sourceDocumentId: request.sourceDocumentId,
    requestStatus: request.status,
    amount: Number(request.amount || 0),
    currency: execution.currency || 'IDR',
    recipientCount: request.recipientCount,
    execution: {
      id: execution.id,
      status: execution.status,
      providerChannel: execution.provider_channel ?? null,
      createdAt: execution.created_at ?? null,
      completedAt: execution.completed_at ?? null,
      updatedAt: execution.updated_at ?? null,
      errorCode: execution.error_code ?? null,
      errorMessage: execution.error_message ?? null,
    },
    summary: {
      recordedRecipients: recipients.length,
      succeeded: recipients.filter(item => item.status === 'SUCCEEDED').length,
      failed: recipients.filter(item => item.status === 'FAILED').length,
      pending: recipients.filter(item => !['SUCCEEDED', 'FAILED'].includes(item.status)).length,
      recordedAmount: recipients.reduce((sum, item) => sum + item.amount, 0),
      recordedFeeAmount: recipients.reduce((sum, item) => sum + item.feeAmount, 0),
    },
    recipients,
  };
}
