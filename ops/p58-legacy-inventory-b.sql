-- Read-only independent SELECT queries: do not combine with UNION ALL (Cloudflare D1 bound).
SELECT 'CANONICAL_REQUESTS' AS metric,COUNT(*) AS records,COALESCE(SUM(amount),0) AS amount_idr FROM disbursement_requests;
SELECT 'CANONICAL_EXECUTIONS' AS metric,COUNT(*) AS records,COALESCE(SUM(amount),0) AS amount_idr FROM disbursement_executions;
SELECT 'EWA_DISBURSED_OR_REPAID' AS metric,COUNT(*) AS records,COALESCE(SUM(amount),0) AS amount_idr FROM ewa_requests WHERE status IN ('DISBURSED','REPAYING','REPAID');
SELECT 'EWA_CANDIDATE_APPROVED_WITHOUT_CANONICAL' AS metric,COUNT(*) AS records,COALESCE(SUM(ewa.amount),0) AS amount_idr FROM ewa_requests ewa WHERE ewa.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM disbursement_requests dr WHERE dr.org_id=ewa.org_id AND dr.source_document_type='EWA_REQUEST' AND dr.source_document_id=ewa.id);
SELECT 'E2PAY_SUBACCOUNTS' AS metric,COUNT(*) AS records,0 AS amount_idr FROM payment_provider_accounts WHERE provider='E2PAY' AND account_scope='SUB_ACCOUNT';
SELECT 'SUBACCOUNT_CREDENTIAL_MANUAL' AS metric,COUNT(*) AS records,0 AS amount_idr FROM provider_provisioning_sessions pps JOIN payment_provider_accounts ppa ON ppa.id=pps.provider_account_registry_id WHERE ppa.provider='E2PAY' AND ppa.account_scope='SUB_ACCOUNT' AND pps.credential_state='LEGACY_MANUAL';
SELECT 'SUBACCOUNT_CREDENTIAL_HEALTHY' AS metric,COUNT(*) AS records,0 AS amount_idr FROM provider_provisioning_sessions pps JOIN payment_provider_accounts ppa ON ppa.id=pps.provider_account_registry_id WHERE ppa.provider='E2PAY' AND ppa.account_scope='SUB_ACCOUNT' AND pps.credential_state='HEALTHY';
SELECT 'LEGACY_COMPATIBILITY' AS metric,COUNT(*) AS records,0 AS amount_idr FROM legacy_compatibility_records;
SELECT 'LEGACY_RECOVERY_REQUIRED' AS metric,COUNT(*) AS records,0 AS amount_idr FROM legacy_compatibility_records WHERE compatibility_status='RECOVERY_REQUIRED';
SELECT 'LEGACY_RETAIN_ONLY' AS metric,COUNT(*) AS records,0 AS amount_idr FROM legacy_compatibility_records WHERE compatibility_status='RETAIN_LEGACY';
SELECT 'LIMIT_RESERVED_LEGACY' AS metric,COUNT(*) AS records,COALESCE(SUM(reserved_amount),0) AS amount_idr FROM e2pay_disbursement_limit_usage WHERE status='RESERVED';
SELECT 'CORPORATE_PRIMARY_UNGOVERNED' AS metric,COUNT(*) AS records,0 AS amount_idr FROM client_bank_accounts cba WHERE cba.status='VERIFIED' AND cba.is_primary=1 AND (cba.source_change_request_id IS NULL OR cba.verification_version=0);
