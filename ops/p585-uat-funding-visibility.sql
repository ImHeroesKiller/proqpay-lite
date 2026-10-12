-- P5.8.5 UAT operational funding visibility. READ ONLY: aggregated metrics.
SELECT
 (SELECT COUNT(*) FROM payment_provider_accounts ppa WHERE ppa.provider='E2PAY' AND ppa.account_scope='SUB_ACCOUNT' AND ppa.environment='UAT' AND ppa.status='ACTIVE') AS uat_active_accounts,
 (SELECT COUNT(*) FROM payment_provider_accounts ppa WHERE ppa.provider='E2PAY' AND ppa.account_scope='SUB_ACCOUNT' AND ppa.environment='UAT' AND ppa.status='ACTIVE'
   AND EXISTS(SELECT 1 FROM legacy_data_cutover_records ldc WHERE ldc.org_id=ppa.org_id AND ldc.source_account_id=ppa.id AND ldc.source_type='UAT_PROVIDER_ACCOUNT' AND ldc.environment='UAT')
   AND NOT EXISTS(SELECT 1 FROM payment_instructions pi LEFT JOIN uat_administrative_closures closed ON closed.org_id=pi.org_id AND closed.source_document_id=pi.id WHERE pi.org_id=ppa.org_id AND pi.provider_account_registry_id=ppa.id AND closed.id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM disbursement_requests dr WHERE dr.org_id=ppa.org_id AND dr.provider_account_registry_id=ppa.id AND (dr.status NOT IN('REJECTED','CANCELLED') OR EXISTS(SELECT 1 FROM disbursement_executions de WHERE de.disbursement_request_id=dr.id)))
   AND NOT EXISTS(SELECT 1 FROM payment_gateway_transactions gt JOIN payment_instructions pi ON pi.id=gt.payment_instruction_id AND pi.org_id=gt.org_id WHERE gt.org_id=ppa.org_id AND pi.provider_account_registry_id=ppa.id)
   AND NOT EXISTS(SELECT 1 FROM e2pay_disbursement_limit_requests lr WHERE lr.org_id=ppa.org_id AND lr.provider_account_registry_id=ppa.id AND lr.status IN('PENDING_APPROVAL','ACTIVE'))) AS archived_uat_hidden_accounts,
 (SELECT COUNT(*) FROM payment_provider_accounts ppa WHERE ppa.provider='E2PAY' AND ppa.account_scope='SUB_ACCOUNT' AND ppa.environment='PRODUCTION' AND ppa.status='ACTIVE') AS production_accounts_unaffected,
 (SELECT COUNT(*) FROM uat_administrative_closures) AS closed_uat_instructions,
 (SELECT COALESCE(SUM(amount_idr),0) FROM uat_administrative_closures) AS closed_uat_amount_idr,
 (SELECT COUNT(*) FROM uat_administrative_closures c JOIN payment_gateway_transactions gt ON gt.payment_instruction_id=c.source_document_id AND gt.org_id=c.org_id) AS closed_uat_gateway_collisions,
 (SELECT COUNT(*) FROM uat_administrative_closures c JOIN disbursement_requests dr ON dr.source_document_type='PAYMENT_INSTRUCTION' AND dr.source_document_id=c.source_document_id AND dr.org_id=c.org_id) AS closed_uat_dr_collisions;
