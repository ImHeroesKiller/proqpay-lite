PRAGMA foreign_keys = ON;
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_provisioning_registry
  ON provider_provisioning_sessions(provider_account_registry_id)
  WHERE provider_account_registry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_provisioning_client_default
  ON provider_provisioning_sessions(org_id,client_id,provider,environment)
  WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_provisioning_project_override
  ON provider_provisioning_sessions(org_id,client_id,project_id,provider,environment)
  WHERE project_id IS NOT NULL;
