PRAGMA foreign_keys = ON;

-- P5.7.2 Automated Credential Lifecycle Hardening
ALTER TABLE provider_provisioning_sessions ADD COLUMN credential_state TEXT NOT NULL DEFAULT 'UNINITIALIZED'
  CHECK (credential_state IN ('UNINITIALIZED','HEALTHY','DEGRADED','RECOVERY_REQUIRED','LEGACY_MANUAL'));
ALTER TABLE provider_provisioning_sessions ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0 CHECK (credential_version >= 0);
ALTER TABLE provider_provisioning_sessions ADD COLUMN credential_last_validated_at TEXT;
ALTER TABLE provider_provisioning_sessions ADD COLUMN credential_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (credential_failure_count >= 0);
ALTER TABLE provider_provisioning_sessions ADD COLUMN credential_last_error_code TEXT;
ALTER TABLE provider_provisioning_sessions ADD COLUMN credential_last_error_at TEXT;

UPDATE provider_provisioning_sessions
SET credential_state=CASE
      WHEN state='READY' THEN 'HEALTHY'
      WHEN credential_mode='SERVICE_MANAGED' THEN 'UNINITIALIZED'
      ELSE 'LEGACY_MANUAL'
    END,
    credential_version=CASE WHEN state='READY' THEN 1 ELSE 0 END,
    credential_last_validated_at=CASE WHEN state='READY' THEN COALESCE(ready_at,updated_at) ELSE NULL END;

CREATE INDEX IF NOT EXISTS idx_provider_provisioning_credential_health
  ON provider_provisioning_sessions(org_id,provider,environment,credential_state,credential_last_validated_at);
