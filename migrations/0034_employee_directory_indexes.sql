PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_employees_org_name_id
  ON employees(org_id,name,id);

CREATE INDEX IF NOT EXISTS idx_employee_assignments_current_created
  ON employee_assignments(employee_id,is_current,created_at);

CREATE INDEX IF NOT EXISTS idx_employee_contracts_current_created
  ON employee_contracts(employee_id,is_current,created_at);

CREATE INDEX IF NOT EXISTS idx_employee_bank_primary_created
  ON employee_bank_accounts(employee_id,is_primary,created_at);

CREATE INDEX IF NOT EXISTS idx_employee_education_rank
  ON employee_education(employee_id,is_highest,graduate_year);
