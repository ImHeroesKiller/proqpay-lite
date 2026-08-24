-- Employee codes/NRK are client-scoped business identifiers, not organization-global identifiers.
DROP INDEX IF EXISTS idx_employee_code_org;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_code_client
  ON employees(org_id, client_id, employee_code)
  WHERE employee_code IS NOT NULL AND client_id IS NOT NULL;
