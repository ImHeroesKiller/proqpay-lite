# ProQPay P5.8 — Zero-Data-Loss Legacy Migration / Dry-Run Audit

Baseline: 2026-10-12T12:36:16Z. Evidence: [P5.8 D1 aggregate-only run 38249997455](https://github.com/ImHeroesKiller/proqpay-lite/actions/runs/38249997455). Read-only; no PI, EWA, gateway, provider accounts, limits or beneficiary rows modified by inventory.

## Production D1 inventory

| Data class | Count | Amount (IDR) |
| --- | ---: | ---: |
| Clients | 2 | - |
| Projects | 3 | - |
| Employees | 65 | - |
| Payment Instructions | 2 | 347,136,095 |
| PI eligible to be CONSIDERED for canonical creation, with no existing gateway or DR | 1 | 15,900,000 |
| Payment gateway legacy transactions / items | 0 / 0 | 0 |
| Gateway in-flight / terminal | 0 / 0 | 0 |
| PI having both gateway & canonical DR | 0 | 0 |
| Canonical DR / executions | 0 / 0 | 0 |
| EWA historical disbursed/repaid | 0 | 0 |
| EWA approved with no canonical | 0 | 0 |
| E2Pay subaccounts | 2 | - |
| Legacy credential state LEGACY_MANUAL | 1 | - |
| Credential state HEALTHY | 0 | - |
| Legacy compatibility recovery required | 1 | - |
| Legacy reserved limits | 0 | 0 |
| Corporate primary beneficiary ungoverned | 0 | - |

**Important:** a zero gateway row count means zero **in active production D1 at inventory time**. It does **not** prove that deleted legacy/UAT rows, historical provider payouts or external E2Pay transactions never existed. Recovery from pre-reset database exports, Cloudflare backups, approved reconciliation statements and provider history needs independent review. No synthetic payout may be fabricated to backfill history.

## P5.8 implemented safe cutover foundations

- A unified workspace includes **Canonical Transactions** and **Legacy History (Read Only)**. Old gateway rows remain stored in original gateway tables, with record IDs preserved and read-only historical projection (pagination, client, project, period, status and masked account details). No execution, retry, or provider POST is exposed from the history lane.
- Fixed P5.7.9 compatibility audit collision on source-stable primary IDs by updating `classification` on `ON CONFLICT(id)`. Dynamic credential recovery classification transitions are verified by tests.
- Original PI / EWA financial strategies and P0.A double-payment database triggers remain unchanged. Legacy subaccounts are never recreated.
- 943/943 full regression, lint, typecheck, production build/CSP PASS at test baseline. 4 dedicated P5.8 tests verify tenancy, masking, non-executable history and recovery classification.

## P5.8 decisions pending operational approval

1. **Credential recovery:** one existing subaccount remains `LEGACY_MANUAL`. Recover using E2Pay-issued merchant credentials, validate balance and liquidity. No invented tokens or subaccount registration.
2. **Eligible PI:** one PI (IDR 15,900,000) meets *preliminary* source eligibility. Before converting via existing Processor-driven `CREATE` (not bulk import), validate current PI snapshot, beneficiary accounts, approval lineage, channel mapping evidence, parent/subclient liquidity, Controller-approved limits, and fresh provider status. Do not auto-execute.
3. **Missing deleted history:** compare original D1 backups and authorized E2Pay provider statements to distinguish zero historical activity from previously deleted test/financial records. If history is found in backups, import only via a reviewed, separate immutable **non-executable** archival pipeline, never by inserting `disbursement_requests` or replaying payouts.
4. **Final UI cutover:** remove legacy payment execution affordances only after operator-verified reconciliation, MFA-authenticated Processor and Controller UAT, funding/recovery and source counts pass. Until then keep legacy reconciliation available for any existing in-flight source.

## Release / rollback posture

P5.8.0 inventory and P5.8.1 history view are additive/read-only. No destructive schema migration or data copying occurs. Rollback of UI/API can be performed by reverting the app commit without rolling back financial D1 rows. Live financial cutover remains **BLOCKED** pending credential readiness, authenticated role UAT and reconciled source evidence.
