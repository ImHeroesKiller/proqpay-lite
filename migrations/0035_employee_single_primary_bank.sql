PRAGMA foreign_keys = ON;

-- Normalize legacy duplicate primary bank rows deterministically before enforcing
-- the single-primary invariant relied on by payroll snapshots and Payment Instruction.
UPDATE employee_bank_accounts
SET is_primary=0
WHERE is_primary=1
  AND id NOT IN (
    SELECT id
    FROM (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY employee_id
          ORDER BY COALESCE(created_at,'') DESC,id DESC
        ) AS rn
      FROM employee_bank_accounts
      WHERE is_primary=1
    ) ranked
    WHERE rn=1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_bank_one_primary
  ON employee_bank_accounts(employee_id)
  WHERE is_primary=1;
