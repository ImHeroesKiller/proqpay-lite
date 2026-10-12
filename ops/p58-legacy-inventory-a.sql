-- P5.8 read-only production inventory; NEVER write or expose account IDs, PII,
-- merchant credentials, bank numbers, provider references or individual records.
SELECT 'ORGANIZATIONS' AS metric,COUNT(*) AS records,0 AS amount_idr FROM organizations
UNION ALL SELECT 'CLIENTS',COUNT(*),0 FROM clients
UNION ALL SELECT 'PROJECTS',COUNT(*),0 FROM projects
UNION ALL SELECT 'EMPLOYEES',COUNT(*),0 FROM employees
UNION ALL SELECT 'PAYMENT_INSTRUCTIONS',COUNT(*),COALESCE(SUM(expected_total),0) FROM payment_instructions
UNION ALL SELECT 'GATEWAY_TRANSACTIONS',COUNT(*),COALESCE(SUM(amount),0) FROM payment_gateway_transactions
UNION ALL SELECT 'GATEWAY_ITEMS',COUNT(*),COALESCE(SUM(amount),0) FROM payment_gateway_items
UNION ALL SELECT 'GATEWAY_INFLIGHT',COUNT(*),COALESCE(SUM(amount),0) FROM payment_gateway_transactions WHERE status IN ('CREATED','PENDING','PROCESSING')
UNION ALL SELECT 'GATEWAY_TERMINAL',COUNT(*),COALESCE(SUM(amount),0) FROM payment_gateway_transactions WHERE status NOT IN ('CREATED','PENDING','PROCESSING')
UNION ALL SELECT 'PI_CANONICAL_ELIGIBLE_NO_FINANCIAL_ACTIVITY',COUNT(*),COALESCE(SUM(pi.expected_total),0) FROM payment_instructions pi WHERE pi.status IN ('PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT') AND NOT EXISTS (SELECT 1 FROM payment_gateway_transactions pgt WHERE pgt.org_id=pi.org_id AND pgt.payment_instruction_id=pi.id) AND NOT EXISTS (SELECT 1 FROM disbursement_requests dr WHERE dr.org_id=pi.org_id AND dr.source_document_type='PAYMENT_INSTRUCTION' AND dr.source_document_id=pi.id)
UNION ALL SELECT 'PI_GATEWAY_AND_CANONICAL_COLLISIONS',COUNT(*),COALESCE(SUM(pi.expected_total),0) FROM payment_instructions pi WHERE EXISTS(SELECT 1 FROM payment_gateway_transactions pgt WHERE pgt.org_id=pi.org_id AND pgt.payment_instruction_id=pi.id) AND EXISTS(SELECT 1 FROM disbursement_requests dr WHERE dr.org_id=pi.org_id AND dr.source_document_type='PAYMENT_INSTRUCTION' AND dr.source_document_id=pi.id AND dr.status NOT IN ('REJECTED','CANCELLED'))
UNION ALL SELECT 'PI_GATEWAY_NO_CANONICAL',COUNT(*),COALESCE(SUM(pi.expected_total),0) FROM payment_instructions pi WHERE EXISTS(SELECT 1 FROM payment_gateway_transactions pgt WHERE pgt.org_id=pi.org_id AND pgt.payment_instruction_id=pi.id) AND NOT EXISTS(SELECT 1 FROM disbursement_requests dr WHERE dr.org_id=pi.org_id AND dr.source_document_type='PAYMENT_INSTRUCTION' AND dr.source_document_id=pi.id);
