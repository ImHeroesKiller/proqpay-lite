-- P5.8.3 UAT reset eligibility inventory (read-only). NO source IDs or secrets.
SELECT 'UAT_E2PAY_ACCOUNTS' AS metric,COUNT(*) AS records FROM payment_provider_accounts ppa
 WHERE ppa.provider='E2PAY' AND ppa.environment='UAT' AND ppa.account_scope='SUB_ACCOUNT';
SELECT 'UAT_PROVIDER_LINKED_PI' AS metric,COUNT(*) AS records FROM payment_instructions pi
 JOIN payment_provider_accounts ppa ON ppa.id=pi.provider_account_registry_id AND ppa.org_id=pi.org_id
 WHERE ppa.provider='E2PAY' AND ppa.environment='UAT' AND ppa.account_scope='SUB_ACCOUNT';
SELECT 'UAT_PROVIDER_LINKED_GATEWAY' AS metric,COUNT(*) AS records FROM payment_gateway_transactions gt
 JOIN payment_instructions pi ON pi.id=gt.payment_instruction_id AND pi.org_id=gt.org_id
 JOIN payment_provider_accounts ppa ON ppa.id=pi.provider_account_registry_id AND ppa.org_id=pi.org_id
 WHERE ppa.provider='E2PAY' AND ppa.environment='UAT' AND ppa.account_scope='SUB_ACCOUNT';
SELECT 'UAT_PROVIDER_LINKED_CANONICAL' AS metric,COUNT(*) AS records FROM disbursement_requests dr
 JOIN payment_provider_accounts ppa ON ppa.id=dr.provider_account_registry_id AND ppa.org_id=dr.org_id
 WHERE ppa.provider='E2PAY' AND ppa.environment='UAT' AND ppa.account_scope='SUB_ACCOUNT';
SELECT 'UAT_CUTOVER_CATALOG_RECORDS' AS metric,COUNT(*) AS records FROM legacy_data_cutover_records
 WHERE environment='UAT';
