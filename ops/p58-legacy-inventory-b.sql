-- P5.8 read-only production inventory; NEVER write or expose account IDs, PII,
-- merchant credentials, bank numbers, provider references or individual records.
SELECT 'CANONICAL_REQUESTS' AS metric,COUNT(*) AS records,COALESCE(SUM(amount),0) AS amount_idr FROM disbursement_requests
UNION ALL SELECT 'CANONICAL_EXECUTIONS',COUNT(*),COALESCE(SUM(amount),0) FROM disbursement_executions
UNION ALL SELECT 'EWA_DISBURSED_OR_REPAID',COUNT(*),COALESCE(SUM(amount),0) FROM ewa_requests WHERE status IN ('DISBURSED','REPAYING','REPAID')
UNION ALL SELECT 'EWA_CANDIDATE_APPROVED_WITHOUT_CANONICAL',COUNT(*),COALESCE(SUM(ewa.amount),0) FROM ewa_requests ewa WHERE ewa.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM disbursement_requests dr WHERE dr.org_id=ewa.org_id AND dr.source_document_type='EWA_REQUEST' AND dr.source_document_id=ewa.id)
UNION ALL SELECT 'E2PAY_SUBACCOUNTS',COUNT(*),0 FROM payment_provider_accounts WHERE provider='E2PAY' AND account_scope='SUB_ACCOUNT'
UNION ALL SELECT 'SUBACCOUNT_CREDENTIAL_MANUAL',COUNT(*),0 FROM provider_provisioning_sessions pps JOIN payment_provider_accounts ppa ON ppa.id=pps.provider_account_registry_id WHERE ppa.provider='E2PAY' AND ppa.account_scope='SUB_ACCOUNT' AND pps.credential_state='LEGACY_MANUAL'
UNION ALL SELECT 'SUBACCOUNT_CREDENTIAL_HEALTHY',COUNT(*),0 FROM provider_provisioning_sessions pps JOIN payment_provider_accounts ppa ON ppa.id=pps.provider_account_registry_id WHERE ppa.provider='E2PAY' AND ppa.account_scope='SUB_ACCOUNT' AND pps.credential_state='HEALTHY'
UNION ALL SELECT 'LEGACY_COMPATIBILITY',COUNT(*),0 FROM legacy_compatibility_records
UNION ALL SELECT 'LEGACY_RECOVERY_REQUIRED',COUNT(*),0 FROM legacy_compatibility_records WHERE compatibility_status='RECOVERY_REQUIRED'
UNION ALL SELECT 'LEGACY_RETAIN_ONLY',COUNT(*),0 FROM legacy_compatibility_records WHERE compatibility_status='RETAIN_LEGACY'
UNION ALL SELECT 'LIMIT_RESERVED_LEGACY',COUNT(*),COALESCE(SUM(reserved_amount),0) FROM e2pay_disbursement_limit_usage WHERE status='RESERVED'
UNION ALL SELECT 'CORPORATE_PRIMARY_UNGOVERNED',COUNT(*),0 FROM client_bank_accounts cba WHERE cba.status='VERIFIED' AND cba.is_primary=1 AND (cba.source_change_request_id IS NULL OR cba.verification_version=0);
