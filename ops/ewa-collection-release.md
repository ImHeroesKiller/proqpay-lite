# EWA allocation and collection integrity release

Scope: audit findings F01–F06. This release does not change EWA fees, entitlement,
salary reference selection, approval order, provider channel, or payroll gross.

## Data model

Migration 0074 creates a permanent allocation per EWA request. A successful claim
atomically deducts principal plus fee, binds the loan to one pay run and records
the system audit event. A stale claim never overwrites a newer payroll correction.
An allocated line cannot be excluded, financially edited or deleted. Its pay run
cannot be cancelled, deleted or moved to another client/period. Bank refresh and
ordinary workflow transitions remain available. Do not delete allocations to
unlock revisions: a future controlled release/reallocation workflow requires a
separately reviewed implementation and cannot be simulated with direct SQL.

Collection requires a completed immutable PI, MATCHED reconciliation with exact
header/line/proof totals and recipient count, and an exact line for the allocated
employee's net. Collection, loan closure and collection audit commit together.
Replays produce neither a second deduction nor a second collection audit.

Historical REPAYING rows are not automatically adopted or marked paid. Legacy
EWA component markers without a matching allocation stop finalization for review.
Multiple outstanding loans for one employee in one pay run also fail closed;
this release does not introduce installments, automatic carry-forward or netting.

Migration 0075 prevents revocation while either legacy or canonical DR reservations
are active. Migration 0076 revalidates approved EWA source, client consent, client
scope and amount at DR creation and approval/execution transitions. DR status
decisions use compare-and-set with conditional audit events and conflict responses.

## Before production rollout

1. Review the exact commit, CI and migration SQL. Use an isolated UAT database;
   the previously audited preview binding shares production data and must not be
   used for financial test writes. Do not copy production encryption keys to it.
2. Record production deployment/commit as rollback target and export/verify a D1
   backup using the existing reviewed migration workflow. Verify account, DB and
   R2 identities. Never reveal credential values.
3. Pause payroll finalization and financial execution during cutover. Run fresh
   read-only counts by EWA status. If DISBURSED or REPAYING loans exist, review
   and reconcile their payroll/PI evidence before rollout; no automatic backfill.
4. Apply 0074–0076 before deploying application code that references the allocation
   table/view. Keep the migration and deployment at the same reviewed commit.
5. Verify migration objects, foreign-key integrity, existing PI totals/counts/hashes,
   and unchanged historical EWA status totals before reopening writes.

## Validation after rollout

- Health ready; expected immutable deployment commit; no schema/configuration 5xx.
- Read-only UI smoke for employee, client, Processor and Controller scopes.
- Structured 503 with correlation ID when a payment profile cannot be decrypted;
  this does not repair the profile or imply provider/funding readiness.
- Controlled isolated UAT: employee submit → client decision → Processor decision
  → DR → Controller → provider-confirmed disbursement → one payroll allocation
  → exact paid PI reconciliation → one collection audit. Use provider UAT only.
- Race/negative cases: regular vs off-cycle claim, double approval, stale cancel,
  failed audit, stale payroll amounts, wrong employee/PI amount, unpaid/mismatched
  reconciliation, reserved-limit revocation and missing source consent.
- Do not infer readiness from application health: Master identity, fresh balance,
  active client limit and provider contract must each pass independently.

## Rollback and remaining audit scope

Stop writes on any failed gate. Roll back the application to the recorded release
while retaining allocation/collection evidence and the additive database guards.
Older repayment code may fail closed against these guards; do not drop triggers,
delete allocations, restore over newer financial activity, or mark loans paid to
force rollback. Prefer a reviewed forward fix when new allocations exist.

Preview isolation and ambiguous cross-client ESS login codes remain separate
audit findings. Enrollment-disable semantics, minimum working days, salary basis,
repayment scheduling and installment policy still need explicit business decisions.
No funding/limit, ledger history, credential or production transaction is fabricated
by these migrations.
