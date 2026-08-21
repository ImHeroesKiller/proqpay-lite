-- Run read-only after migration and before cutover.
SELECT 'organizations' AS metric, COUNT(*) AS value FROM organizations
UNION ALL SELECT 'clients', COUNT(*) FROM clients
UNION ALL SELECT 'projects', COUNT(*) FROM projects
UNION ALL SELECT 'employees', COUNT(*) FROM employees
UNION ALL SELECT 'primary_bank_accounts', COUNT(*) FROM employee_bank_accounts WHERE is_primary=1
UNION ALL SELECT 'payroll_submissions', COUNT(*) FROM payroll_submissions
UNION ALL SELECT 'payment_instructions', COUNT(*) FROM payment_instructions
UNION ALL SELECT 'payment_instruction_lines', COUNT(*) FROM payment_instruction_lines
UNION ALL SELECT 'payment_proofs', COUNT(*) FROM payment_proofs
UNION ALL SELECT 'reconciliations', COUNT(*) FROM reconciliations
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
UNION ALL SELECT 'ar_monitor', COUNT(*) FROM ar_monitor;

SELECT
  pi.id,
  pi.status,
  pi.recipient_count AS header_recipients,
  COUNT(pil.id) AS line_recipients,
  pi.expected_total AS header_total,
  COALESCE(SUM(pil.amount),0) AS line_total,
  pi.content_hash,
  CASE
    WHEN pi.recipient_count=COUNT(pil.id)
      AND pi.expected_total=COALESCE(SUM(pil.amount),0)
      AND pi.content_hash IS NOT NULL
    THEN 'MATCH' ELSE 'MISMATCH'
  END AS control_status
FROM payment_instructions pi
LEFT JOIN payment_instruction_lines pil ON pil.payment_instruction_id=pi.id
GROUP BY pi.id
ORDER BY pi.created_at;

SELECT
  e.id AS employee_id,
  SUM(CASE WHEN eba.is_primary=1 THEN 1 ELSE 0 END) AS primary_accounts
FROM employees e
LEFT JOIN employee_bank_accounts eba ON eba.employee_id=e.id
GROUP BY e.id
HAVING SUM(CASE WHEN eba.is_primary=1 THEN 1 ELSE 0 END)<>1;

SELECT name AS forbidden_legacy_table
FROM sqlite_master
WHERE type='table' AND name IN ('payments','approvals','payrolls');
