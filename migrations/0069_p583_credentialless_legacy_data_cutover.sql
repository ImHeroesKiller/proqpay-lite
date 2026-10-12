PRAGMA foreign_keys=ON;

-- P5.8.3 UAT DATA-ONLY CUTOVER. It is a durable, immutable reference catalog,
-- not a provider-account reset or a payment instruction migration/replay.
-- Never copy credential blobs, bank account ciphertext or provider tokens.
CREATE TABLE IF NOT EXISTS legacy_data_cutover_records (
 id TEXT PRIMARY KEY,
 org_id TEXT NOT NULL REFERENCES organizations(id),
 client_id TEXT NOT NULL REFERENCES clients(id),
 project_id TEXT REFERENCES projects(id),
 source_type TEXT NOT NULL CHECK(source_type IN ('UAT_PROVIDER_ACCOUNT','UAT_PAYMENT_INSTRUCTION')),
 source_id TEXT NOT NULL,
 source_account_id TEXT NOT NULL REFERENCES payment_provider_accounts(id),
 environment TEXT NOT NULL DEFAULT 'UAT' CHECK(environment='UAT'),
 legacy_status TEXT NOT NULL,
 amount_idr INTEGER NOT NULL DEFAULT 0 CHECK(amount_idr>=0),
 cutover_status TEXT NOT NULL DEFAULT 'DATA_ONLY' CHECK(cutover_status='DATA_ONLY'),
 execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK(execution_allowed=0),
 original_rows_retained INTEGER NOT NULL DEFAULT 1 CHECK(original_rows_retained=1),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(org_id,source_type,source_id)
);
CREATE INDEX IF NOT EXISTS idx_legacy_data_cutover_org ON legacy_data_cutover_records(org_id,client_id,source_type,created_at DESC);

-- Preserve durable provenance: any reset that touches a referenced account
-- must explicitly retire/copy its PI references first, never silently orphan.
CREATE TRIGGER IF NOT EXISTS legacy_cutover_immutable_update
BEFORE UPDATE ON legacy_data_cutover_records BEGIN
 SELECT RAISE(ABORT,'LEGACY_DATA_CUTOVER_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS legacy_cutover_immutable_delete
BEFORE DELETE ON legacy_data_cutover_records BEGIN
 SELECT RAISE(ABORT,'LEGACY_DATA_CUTOVER_IMMUTABLE');
END;

-- Data-only logical cutover: expose existing UAT subaccounts in the new UI.
-- Zero financial rows are altered. Active provider credentials are unaffected.
INSERT OR IGNORE INTO legacy_data_cutover_records
(id,org_id,client_id,project_id,source_type,source_id,source_account_id,environment,legacy_status,amount_idr)
SELECT 'LDC-PPA-'||ppa.id,ppa.org_id,ppa.client_id,ppa.project_id,
 'UAT_PROVIDER_ACCOUNT',ppa.id,ppa.id,'UAT',ppa.status,0
FROM payment_provider_accounts ppa
WHERE ppa.provider='E2PAY' AND ppa.environment='UAT' AND ppa.account_scope='SUB_ACCOUNT';

-- The existing immutable PI is the source of truth. Its original ID, bank
-- snapshot, hash, approval trail and account binding remain unchanged.
INSERT OR IGNORE INTO legacy_data_cutover_records
(id,org_id,client_id,project_id,source_type,source_id,source_account_id,environment,legacy_status,amount_idr)
SELECT 'LDC-PI-'||pi.id,pi.org_id,pi.client_id,ps.project_id,
 'UAT_PAYMENT_INSTRUCTION',pi.id,ppa.id,'UAT',pi.status,pi.expected_total
FROM payment_instructions pi
JOIN payroll_submissions ps ON ps.id=pi.submission_id AND ps.org_id=pi.org_id
JOIN payment_provider_accounts ppa ON ppa.id=pi.provider_account_registry_id
 AND ppa.org_id=pi.org_id AND ppa.client_id=pi.client_id
WHERE ppa.provider='E2PAY' AND ppa.environment='UAT'
 AND ppa.account_scope='SUB_ACCOUNT' AND pi.provider_environment='UAT'
 AND pi.provider_sub_account_id=ppa.provider_sub_account_id
 AND pi.expected_total>=0;
