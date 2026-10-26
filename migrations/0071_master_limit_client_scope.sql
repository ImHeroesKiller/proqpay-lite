-- Master accounts are shared across clients. Keep duplicate protection within
-- each client/project scope rather than preventing all other client allocations.
-- COALESCE is essential: SQLite UNIQUE indexes otherwise allow duplicate NULL
-- project scopes. Existing account-wide indexes already guarantee no duplicates
-- in the narrower scope, so this migration requires no data rewrite.
DROP INDEX IF EXISTS uq_e2pay_limit_pending_per_account;
DROP INDEX IF EXISTS uq_e2pay_limit_active_per_account;

CREATE UNIQUE INDEX IF NOT EXISTS uq_e2pay_limit_pending_per_client_project
  ON e2pay_disbursement_limit_requests(org_id,provider_account_registry_id,client_id,COALESCE(project_id,''))
  WHERE status='PENDING_APPROVAL';

CREATE UNIQUE INDEX IF NOT EXISTS uq_e2pay_limit_active_per_client_project
  ON e2pay_disbursement_limit_requests(org_id,provider_account_registry_id,client_id,COALESCE(project_id,''))
  WHERE status='ACTIVE';
