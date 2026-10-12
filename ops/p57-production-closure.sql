-- P5.7.10 canonical production closure assertions.
-- Every SELECT returns zero rows when the canonical payment system is internally consistent.

SELECT 'DR_APPROVAL_METADATA_MISSING' AS violation_type, id AS entity_id
FROM disbursement_requests
WHERE status IN ('APPROVED','EXECUTING','PROCESSING','PARTIALLY_SETTLED','SETTLED','FAILED','RECONCILIATION_REQUIRED','RECONCILED')
  AND (approved_by_email IS NULL OR approved_at IS NULL);

SELECT 'DR_EXECUTION_LEDGER_MISSING' AS violation_type, dr.id AS entity_id
FROM disbursement_requests dr
LEFT JOIN disbursement_executions de ON de.disbursement_request_id=dr.id
WHERE dr.status IN ('EXECUTING','PROCESSING','PARTIALLY_SETTLED','SETTLED','FAILED','RECONCILIATION_REQUIRED','RECONCILED')
  AND de.id IS NULL;

SELECT 'DR_CONTROL_TOTAL_MISMATCH' AS violation_type, dr.id AS entity_id
FROM disbursement_requests dr
LEFT JOIN disbursement_request_items dri ON dri.disbursement_request_id=dr.id
GROUP BY dr.id
HAVING dr.recipient_count<>COUNT(dri.id)
   OR dr.amount<>COALESCE(SUM(dri.amount),0);

SELECT 'DR_PROVIDER_CHANNEL_MISSING' AS violation_type, dr.id AS entity_id
FROM disbursement_requests dr
WHERE dr.status IN ('PENDING_APPROVAL','APPROVED','EXECUTING','PROCESSING','PARTIALLY_SETTLED','SETTLED','FAILED','RECONCILIATION_REQUIRED','RECONCILED')
  AND (dr.provider_channel_mapping_id IS NULL OR trim(COALESCE(dr.provider_channel_snapshot,''))='');

SELECT 'ACTIVE_CHANNEL_UNCONFIRMED' AS violation_type, pcm.id AS entity_id
FROM provider_channel_mappings pcm
WHERE pcm.mapping_status='ACTIVE'
  AND (trim(COALESCE(pcm.provider_channel,''))='' OR pcm.config_hash IS NULL OR pcm.confirmed_by IS NULL OR pcm.confirmed_at IS NULL OR pcm.confirmation_reference IS NULL);

SELECT 'CORPORATE_PRIMARY_DUPLICATE' AS violation_type, client_id AS entity_id
FROM client_bank_accounts
WHERE purpose='PAYROLL_SETTLEMENT' AND status='VERIFIED' AND is_primary=1
GROUP BY org_id,client_id,purpose
HAVING COUNT(*)>1;

SELECT 'CORPORATE_PRIMARY_UNGOVERNED' AS violation_type, cba.id AS entity_id
FROM client_bank_accounts cba
LEFT JOIN client_bank_account_change_requests cr ON cr.id=cba.source_change_request_id
WHERE cba.purpose='PAYROLL_SETTLEMENT' AND cba.status='VERIFIED' AND cba.is_primary=1
  AND (cba.verification_version<=0 OR cba.source_change_request_id IS NULL OR cr.status<>'APPROVED');

SELECT 'CANONICAL_LIMIT_DUPLICATE' AS violation_type, disbursement_request_id AS entity_id
FROM e2pay_disbursement_request_limit_usage
WHERE status IN ('RESERVED','CONSUMED')
GROUP BY disbursement_request_id
HAVING COUNT(*)>1;

SELECT 'SETTLED_DR_HAS_UNSETTLED_ITEM' AS violation_type, dr.id AS entity_id
FROM disbursement_requests dr
JOIN disbursement_executions de ON de.disbursement_request_id=dr.id
JOIN disbursement_execution_items dei ON dei.disbursement_execution_id=de.id
WHERE dr.status IN ('SETTLED','RECONCILED')
GROUP BY dr.id
HAVING SUM(CASE WHEN dei.status='SUCCEEDED' THEN 0 ELSE 1 END)>0;

SELECT 'RECONCILED_DR_WITHOUT_ATTEMPT' AS violation_type, dr.id AS entity_id
FROM disbursement_requests dr
WHERE dr.status='RECONCILED'
  AND NOT EXISTS (SELECT 1 FROM disbursement_reconciliation_attempts dra WHERE dra.disbursement_request_id=dr.id AND dra.status='MATCHED');

SELECT 'LEGACY_INFLIGHT_CANONICAL_COLLISION' AS violation_type, pi.id AS entity_id
FROM payment_instructions pi
WHERE EXISTS (
  SELECT 1 FROM payment_gateway_transactions pgt
  WHERE pgt.payment_instruction_id=pi.id AND pgt.status IN ('CREATED','PENDING','PROCESSING')
)
AND EXISTS (
  SELECT 1 FROM disbursement_requests dr
  WHERE dr.source_document_type='PAYMENT_INSTRUCTION' AND dr.source_document_id=pi.id
    AND dr.status NOT IN ('REJECTED','CANCELLED')
);
