# GT5.1.2 — Safe Legacy Removal Audit (2026-10-13)

## Desired active business flow

Data Intake → Payroll → Payment Instruction → Controller Approval → E2Pay MASTER → Reconciliation → Billing.

No submerchant registration, per-client credential, project override, legacy gateway execution, or old provider transaction UI in the active flow.

## Verified production D1 (SELECT only)

Zero rows: legacy_compatibility_records, legacy_data_cutover_records, uat_administrative_closures, provider_provisioning_sessions, payment_provider_accounts, payment_gateway_transactions, e2pay_disbursement_limit_requests, disbursement_requests.

One row each: gateway_secure_settings (encrypted gateway config), payment_gateway_provider_snapshots (historical provider account/balance snapshot). **Retain both.**

PRAGMA foreign_key_check returns zero violations.

## Dependency blockers identified

- legacy_data_cutover_records has two immutable UPDATE/DELETE triggers.
- uat_administrative_closures has two immutable triggers; two additional triggers on disbursement_requests and payment_gateway_transactions reference it for anti-replay.
- payment_gateway_transactions retains two reciprocal anti-double-execution triggers with disbursement_requests.
- disbursement_requests still uses the existing provider_sub_account_id_snapshot NOT NULL field for Master identity compatibility.
- src/components/DirectoryManager.tsx retains unused registration/recovery/balance-sync handlers and deprecated deep-link recovery.
- functions/api/e2pay-subaccounts.js is a 59 KB legacy provisioning/mutation API.
- functions/api/legacy-data-cutover.js and legacy-transaction-history.js expose historical read paths.
- Historical migration files define old tables and their constraints; never erase prior migrations or rebuild production schema casually.

## Approved order of operations for implementation

1. Freeze live payout and back up D1. Independently verify every affected table row count, outbound references, trigger definitions and FK graph.
2. Remove unused DirectoryManager subaccount handlers/API imports, recovery deep links, OTP and project override UI. Keep master-only client/project sections and appropriate corporate beneficiaries.
3. Fail closed on every legacy provisioning/mutation API, ideally 410 GONE for retired routes. Preserve authorization and non-sensitive historical read-only evidence until audited archival is confirmed.
4. Audit every caller of payment_gateway_transactions, legacy cutover and provisioning. Keep anti-replay defenses at source PI / canonical DR boundaries. Do not remove triggers while an endpoint can insert into the old gateway table.
5. Once CI and authenticated role-by-role browser UAT pass, merge/deploy code first; verify health, payment submission, Controller limit approval, canonical DR, reconciliation, reporting, no old UI links and 401/403/410 behavior.
6. Only then, in a **separately approved schema-maintenance release** with backup and rollback, remove provably unreferenced empty tables and dependent triggers in topological order. This cannot happen while the explicit no-new-schema-change constraint is in force. SQLite drop actions change database schema; dropping tables and triggers must not be disguised as cleanup of records.
7. Post-change integrity: PRAGMA foreign_key_check, quick_check, migration ledger, table inventories, trigger anti-replay assertions, role & tenant isolation and full CI/E2E.

## Retain (not orphan)

app_users, sessions, MFA, passkeys, audit_logs, organizations, clients/projects/employees, payroll submissions, immutable PI & recipient lines, controller approvals, canonical DR, disbursement executions/items, limits and usage, reconciliation, invoices, gateway_secure_settings, payment_gateway_provider_snapshots, R2 evidence and security settings.

## Release hold

Current code branch is a draft PR. Unit/typecheck/lint/build and security checks last passed, but full UI dead-code removal, anti-replay cutover, Controller UAT, provider live verification, and independent schema-deletion authorization remain outstanding.

Do NOT execute DROP TABLE/trigger or financial payment on production as part of this audit.
