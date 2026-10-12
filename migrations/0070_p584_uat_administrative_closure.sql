PRAGMA foreign_keys=ON;

-- UAT ONLY: operationally archive provisional PI as 'assumed complete' for a
-- demo, NOT as a confirmed provider-paid / settled transaction. Never change
-- the immutable financial PI, gateway ledger, proofs or reconciliation status.
CREATE TABLE IF NOT EXISTS uat_administrative_closures (
 id TEXT PRIMARY KEY,
 org_id TEXT NOT NULL REFERENCES organizations(id),
 client_id TEXT NOT NULL REFERENCES clients(id),
 source_document_type TEXT NOT NULL CHECK(source_document_type='PAYMENT_INSTRUCTION'),
 source_document_id TEXT NOT NULL REFERENCES payment_instructions(id),
 provider_account_registry_id TEXT NOT NULL REFERENCES payment_provider_accounts(id),
 environment TEXT NOT NULL CHECK(environment='UAT'),
 closure_reason TEXT NOT NULL CHECK(closure_reason='UAT_ASSUMED_COMPLETE_NO_SETTLEMENT_EVIDENCE'),
 provider_settlement_verified INTEGER NOT NULL DEFAULT 0 CHECK(provider_settlement_verified=0),
 financial_execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK(financial_execution_allowed=0),
 amount_idr INTEGER NOT NULL CHECK(amount_idr>0),
 archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(org_id,source_document_type,source_document_id)
);
CREATE INDEX IF NOT EXISTS idx_uat_closure_org ON uat_administrative_closures(org_id,client_id,archived_at DESC);
CREATE TRIGGER IF NOT EXISTS uat_administrative_closure_update_block
BEFORE UPDATE ON uat_administrative_closures BEGIN
 SELECT RAISE(ABORT,'UAT_ADMINISTRATIVE_CLOSURE_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS uat_administrative_closure_delete_block
BEFORE DELETE ON uat_administrative_closures BEGIN
 SELECT RAISE(ABORT,'UAT_ADMINISTRATIVE_CLOSURE_IMMUTABLE');
END;

-- Seed only known UAT PI catalog rows which have neither legacy payments nor
-- canonical DR. Preserve existing source IDs, account/PI snapshots and audit.
INSERT OR IGNORE INTO uat_administrative_closures
(id,org_id,client_id,source_document_type,source_document_id,provider_account_registry_id,
 environment,closure_reason,amount_idr)
SELECT 'UAT-CLOSED-'||pi.id,pi.org_id,pi.client_id,
 'PAYMENT_INSTRUCTION',pi.id,pi.provider_account_registry_id,
 'UAT','UAT_ASSUMED_COMPLETE_NO_SETTLEMENT_EVIDENCE',pi.expected_total
FROM legacy_data_cutover_records ldc
JOIN payment_instructions pi ON pi.id=ldc.source_id AND pi.org_id=ldc.org_id
JOIN payment_provider_accounts ppa ON ppa.id=pi.provider_account_registry_id AND ppa.org_id=pi.org_id
WHERE ldc.source_type='UAT_PAYMENT_INSTRUCTION' AND ldc.environment='UAT'
 AND pi.provider_environment='UAT' AND ppa.environment='UAT' AND ppa.provider='E2PAY'
 AND ppa.provider_sub_account_id=pi.provider_sub_account_id
 AND pi.status IN ('PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT')
 AND pi.expected_total>0
 AND NOT EXISTS (SELECT 1 FROM payment_gateway_transactions gt WHERE gt.org_id=pi.org_id AND gt.payment_instruction_id=pi.id)
 AND NOT EXISTS (SELECT 1 FROM disbursement_requests dr WHERE dr.org_id=pi.org_id AND dr.source_document_type='PAYMENT_INSTRUCTION' AND dr.source_document_id=pi.id);

-- DB-level guards cover both strategies, including old gateway endpoints and
-- concurrent API sessions: closing a demo is never permission to pay it again.
CREATE TRIGGER IF NOT EXISTS uat_closed_pi_canonical_no_replay
BEFORE INSERT ON disbursement_requests
WHEN NEW.source_document_type='PAYMENT_INSTRUCTION' AND EXISTS (
 SELECT 1 FROM uat_administrative_closures c WHERE c.org_id=NEW.org_id
 AND c.source_document_id=NEW.source_document_id)
BEGIN SELECT RAISE(ABORT,'UAT_ARCHIVED_SOURCE_NOT_EXECUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS uat_closed_pi_gateway_no_replay
BEFORE INSERT ON payment_gateway_transactions
WHEN NEW.payment_instruction_id IS NOT NULL AND EXISTS (
 SELECT 1 FROM uat_administrative_closures c WHERE c.org_id=NEW.org_id
 AND c.source_document_id=NEW.payment_instruction_id)
BEGIN SELECT RAISE(ABORT,'UAT_ARCHIVED_SOURCE_NOT_EXECUTABLE'); END;
