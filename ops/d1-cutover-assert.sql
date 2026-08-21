SELECT 'PI_CONTROL_MISMATCH' AS violation_type, pi.id AS entity_id
FROM payment_instructions pi
LEFT JOIN payment_instruction_lines pil ON pil.payment_instruction_id=pi.id
GROUP BY pi.id
HAVING pi.recipient_count<>COUNT(pil.id)
  OR pi.expected_total<>COALESCE(SUM(pil.amount),0)
  OR pi.content_hash IS NULL

UNION ALL

SELECT 'PRIMARY_ACCOUNT_COUNT', e.id
FROM employees e
LEFT JOIN employee_bank_accounts eba ON eba.employee_id=e.id
GROUP BY e.id
HAVING SUM(CASE WHEN eba.is_primary=1 THEN 1 ELSE 0 END)<>1

UNION ALL

SELECT 'PI_ACCOUNT_SNAPSHOT_INCOMPLETE', pil.id
FROM payment_instruction_lines pil
WHERE trim(COALESCE(pil.account_ciphertext,''))=''
   OR trim(COALESCE(pil.account_iv,''))=''
   OR trim(COALESCE(pil.line_hash,''))=''

UNION ALL

SELECT 'LEGACY_PAYMENT_TABLE', name
FROM sqlite_master
WHERE type='table' AND name IN ('payments','approvals','payrolls');
