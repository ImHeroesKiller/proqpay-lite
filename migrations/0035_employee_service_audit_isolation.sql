PRAGMA foreign_keys = ON;

-- Employee Service audit isolation: every new portal login attempt is organization-scoped.
ALTER TABLE portal_login_attempts ADD COLUMN org_id TEXT REFERENCES organizations(id);

UPDATE portal_login_attempts
SET org_id = (
  SELECT e.org_id FROM employees e WHERE e.id = portal_login_attempts.employee_id
)
WHERE org_id IS NULL AND employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_portal_login_attempts_org_created
  ON portal_login_attempts(org_id, created_at);
