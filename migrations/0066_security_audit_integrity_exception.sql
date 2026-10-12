PRAGMA foreign_keys = ON;

-- P5.7.10 forensic closure for an authorized historical UAT cleanup.
-- Migration 0046 (commit 12d8769a221e5c6f6939c934e5e5832883d08fb0) removed
-- E2Pay UAT dummy audit rows after the 2026-10-03 checkpoint had been sealed.
-- The exception is exact-match only: any other row count/hash remains a failure.
CREATE TABLE IF NOT EXISTS security_audit_integrity_exceptions (
  checkpoint_date TEXT PRIMARY KEY,
  sealed_row_count INTEGER NOT NULL CHECK (sealed_row_count >= 0),
  sealed_content_sha256 TEXT NOT NULL CHECK (length(sealed_content_sha256)=64),
  accepted_row_count INTEGER NOT NULL CHECK (accepted_row_count >= 0),
  accepted_content_sha256 TEXT NOT NULL CHECK (length(accepted_content_sha256)=64),
  reason TEXT NOT NULL,
  authorized_change_ref TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO security_audit_integrity_exceptions(
  checkpoint_date,sealed_row_count,sealed_content_sha256,accepted_row_count,accepted_content_sha256,
  reason,authorized_change_ref,authorized_by,authorized_at
) VALUES(
  '2026-10-03',1,'0cb302509b4799188d032b0e37019f5283c65f49cf88446d5d4a802acc94d91c',
  0,'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  'Authorized E2Pay UAT dummy cleanup in migration 0046 deleted a sealed UAT audit row. Future audit-log deletion is prohibited; this exception accepts only the exact historical before/after fingerprint.',
  'migration:0046_reset_e2pay_uat_dummy_data.sql@12d8769a221e5c6f6939c934e5e5832883d08fb0',
  'P5.7.10_SECURITY_CLOSURE','2026-10-12T00:00:00Z'
);
