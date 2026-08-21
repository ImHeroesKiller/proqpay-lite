-- Run read-only after migration and before cutover.
-- Use scalar subqueries instead of a compound UNION. Cloudflare D1's remote
-- execute endpoint can reject compound statements before the later assertions
-- run, even when the individual SELECT terms are valid SQLite.
SELECT
  (SELECT COUNT(*) FROM organizations) AS organizations,
  (SELECT COUNT(*) FROM clients) AS clients,
  (SELECT COUNT(*) FROM projects) AS projects,
  (SELECT COUNT(*) FROM employees) AS employees,
  (SELECT COUNT(*) FROM employee_bank_accounts WHERE is_primary=1) AS primary_bank_accounts,
  (SELECT COUNT(*) FROM payroll_submissions) AS payroll_submissions,
  (SELECT COUNT(*) FROM payment_instructions) AS payment_instructions,
  (SELECT COUNT(*) FROM payment_instruction_lines) AS payment_instruction_lines,
  (SELECT COUNT(*) FROM payment_proofs) AS payment_proofs,
  (SELECT COUNT(*) FROM reconciliations) AS reconciliations,
  (SELECT COUNT(*) FROM invoices) AS invoices,
  (SELECT COUNT(*) FROM ar_monitor) AS ar_monitor;

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
