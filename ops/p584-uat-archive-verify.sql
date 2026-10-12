-- P5.8.4 post-deploy verification. Single read-only aggregate query, no PII.
SELECT
  (SELECT COUNT(*) FROM uat_administrative_closures) AS archived_count,
  (SELECT COALESCE(SUM(amount_idr),0) FROM uat_administrative_closures) AS archived_amount,
  (SELECT COUNT(*) FROM uat_administrative_closures c
    JOIN payment_instructions pi ON pi.id=c.source_document_id AND pi.org_id=c.org_id
    JOIN payment_provider_accounts ppa ON ppa.id=c.provider_account_registry_id AND ppa.org_id=c.org_id
    WHERE pi.provider_environment='UAT' AND ppa.environment='UAT'
    AND pi.client_id=c.client_id AND pi.expected_total=c.amount_idr) AS verified_source_matches,
  (SELECT COUNT(*) FROM uat_administrative_closures
    WHERE provider_settlement_verified<>0 OR financial_execution_allowed<>0) AS false_financial_claims,
  (SELECT COUNT(*) FROM uat_administrative_closures c
    JOIN payment_gateway_transactions gt ON gt.payment_instruction_id=c.source_document_id AND gt.org_id=c.org_id) AS active_gateway_collisions,
  (SELECT COUNT(*) FROM uat_administrative_closures c
    JOIN disbursement_requests dr ON dr.source_document_type='PAYMENT_INSTRUCTION'
       AND dr.source_document_id=c.source_document_id AND dr.org_id=c.org_id) AS canonical_dr_collisions,
  (SELECT COUNT(*) FROM uat_administrative_closures c
    WHERE NOT EXISTS (SELECT 1 FROM legacy_data_cutover_records ldc
      WHERE ldc.org_id=c.org_id AND ldc.source_type='UAT_PAYMENT_INSTRUCTION' AND ldc.source_id=c.source_document_id)) AS missing_provenance;
