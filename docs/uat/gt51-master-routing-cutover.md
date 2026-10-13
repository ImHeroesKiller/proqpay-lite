# GT5.1 — Master Account Routing Cutover (schema unchanged)

## Verified production baseline
- `payment_provider_accounts`: 0 rows after UAT reset. No MASTER registry row is present.
- `gateway_secure_settings`: one E2PAY/UAT encrypted profile (v4); `activated_at` is null. Secrets were not read or rotated.
- `payment_gateway_provider_snapshots`: one UAT provider snapshot. Historical, not a live-balance confirmation.
- All former SUB_ACCOUNT rows were deleted at the operator's request.

## Existing code conflicts preventing a safe live cutover
1. `payment-provider-routing.js/activeProviderAccount` selects only SUB_ACCOUNT and `validatePaymentProviderSnapshot` requires a sub-account ID.
2. `e2pay-disbursement-limit-core.js/readProviderFundingState` requires a provider registry ID and *both* parent and sub-client balances.
3. `e2pay-disbursement-limits.js` queries SUB_ACCOUNT for every new limit and requires `provider_account_registry_id`.
4. `e2pay-subaccounts.js`, scoped merchant credential resolution, funding UX, and canonical DR/legacy PI execution still assume sub-client provisioned accounts.
5. Existing `e2pay_disbursement_limit_requests` has a non-null FK to `payment_provider_accounts`. No safe limit can be written against the current zero-row registry without first designing an approved MASTER registry representation using the *existing* schema.
6. Master account balance is shared pool liquidity; do not represent the same amount as independently available to every client. Enforce global reservation accounting.

## Intended no-schema-change cutover
- Use `gatewayRuntimeEnv` and encrypted `gateway_secure_settings` as the single source of MASTER credentials. Keep env fallback fail-closed and never fall back to orphaned sub-client merchant credentials.
- Use verified `payment_gateway_provider_snapshots` and live refresh exclusively from the Master account; differentiate stale, missing, invalid and insufficient balances.
- Persist one MASTER-scoped `payment_provider_accounts` registry row **only after** contract validation and approval of its link to the authenticated Master E2Pay identity. Existing schema permits MASTER with NULL client_id. The row should not hold duplicate credentials or fabricated balance.
- Keep `client_id` and `project_id` on each request and PI as business ownership; route provider execution to the single MASTER registry reference.
- Refactor `readProviderFundingState`, PI snapshot validation, canonical DR authorization, limit allocation/reservation/consumption, and client-scoped reporting *together*, under maker-checker.
- Avoid a global client-agnostic spending limit that can be double-counted; aggregate all ACTIVE/RESERVED/CONSUMED limits and canonical transaction commitments against the same Master balance.
- Reject stale snapshots, missing credentials, mismatched provider environment, foreign org/tenant, duplicate replay and unauthorized roles.
- UI should show Master liquidity and client allocation **without** presenting deleted subaccounts.
- Preserve existing D1 tables/columns/migrations/triggers, and never change actual provider balance via readiness checks.

## Acceptance gates
1. Typecheck, lint, full unit suite, production build and CI quality gate PASS.
2. Synthetic role/tenant UAT: Controller alone confirms payments; Processor proposes limits; distinct maker-checker actor required.
3. No SUB_ACCOUNT reference in canonical active routing, new PI, limit requests, or funding views (legacy read-only paths may remain explicitly labeled).
4. Master balance acquired live, freshness verified; credentials decrypt correctly, provider account ID matches execution contract.
5. Cross-client aggregation prevents over-allocation and double-spend.
6. Idempotent retries, immutable PI routing and reconciliation correct.
7. No live provider disbursement until all above gates pass. No database schema changes.

Current branch supplies the safe read-only Master readiness contract + unit test foundation. It **does not** claim that the full cutover or live payment readiness is complete.

## GT5.1.1 implementation delta (draft, no production write)
- Added existing-schema MASTER registry binding on privileged E2Pay operations API, requiring live merchant account validation and MFA step-up.
- PI preparation, asynchronous routing submission and Controller PI funding approval can recognize MASTER records and no longer require SUB_ACCOUNT credential readiness.
- Master limit requests require explicit client/project ownership; Controller conditional UPDATE recomputes shared unallocated balance under one D1 write.
- Canonical DR creation, Controller review and canonical execution use the immutable Master registry ID and live validated MASTER gateway secrets (not subclient credentials).
- PI and DR limit reservations are scoped to source client/project IDs.
- Existing field names `provider_sub_account_id_snapshot` in canonical DR and `provider_sub_account_id` in PI are legacy schema constraints; Master DR stores the provider-verified master ID in the required snapshot field, while Master PI leaves the optional sub-account field null. Do not reinterpret this as a new subclient credential.
- All GT5.1.1 changes are in a draft PR, no schema migration or live payout. Need final CI/regression, credential read test, verified provider balance, and Controller-approved UAT.
