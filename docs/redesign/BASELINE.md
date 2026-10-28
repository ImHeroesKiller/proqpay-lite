# ProQPay v2 workspace baseline — 28 October 2026

- Repository: ImHeroesKiller/proqpay-lite; baseline 91f341011aacb6a297c90b7553098883a6e2067a; Next 16 static export + React 19 + Cloudflare Pages Functions.
- Production mapping verified through Cloudflare: proqpay-lite / proqpay.msg-os.com; production deployment 0e36dc5c-dacb-40df-a312-f648c3153b2c, same baseline SHA (rollback reference).
- Existing DB: proqpay-lite-production / ac3f8b48-bd87-44bd-9286-f0e0bab6e39f; FILES: proqpay-lite-files; AI binding present. Preview shares production DB/R2; no remote writes or payment execution permitted during visual verification. No schema/binding/resource changes required; database backup/migrations not applicable to this frontend-only change.
- Automatic Pages deployments disabled. Preview requires explicit branch deployment. Preview lacks production secrets; full authenticated integration UAT cannot be assumed from a successful static deployment.
- Baseline: 1104/1104 node tests pass; typecheck pass; lint 0 errors / 62 existing warnings; build and CSS/CSP integrity gates pass.

## Component and state map

| Surface | Source | State / integration |
| --- | --- | --- |
| Shell | Sidebar, Header, AppWorkspaceRouter | role-scoped navigation, session, mobile drawer retained |
| Payroll stages + shared filters | UnifiedPayrollWorkspace | canonical route-state.ts, client/project/q, popstate, data-intake link |
| Payroll table + actions | OperatingWorkspace / Submissions | operating-model API, business stage + next-action derivation, role queue, review, adjustment and correction dialogs |
| Payment Instruction | OperatingWorkspace / Payments | immutable PI detail, approvals, audit activity, liquidity/MFA and canonical DR links |
| Disbursement | CanonicalDisbursementWorkspace | canonical DR identity, role permissions, batch/idempotent execution, provider evidence, reconciliation |
| Funding | E2PayFundingLimitControl | single Master activation/readiness, balance, internal limit request/approve/revoke |
| Provider configuration | ProviderChannelControl | existing routing controls retained as secondary disclosure |

## Findings and implementation scope

Redundant workflow shortcut + operations summary + next action + payroll summary obscure the table. Payment tab semantics use solid action-button styling. Period picker is missing from embedded workspace. Funding readiness and provider controls dominate the main workspace. Existing CSS is an intentionally ordered compatibility cascade with hash gates; introduce one scoped feature stylesheet without rewriting legacy hashes.

Preserve API/database contracts, canonical route mutation, stale-response guards, role-aware business actions, Controller approval, MFA, maker-checker, tenant isolation, immutable evidence, PI/DR identities and single-Master E2Pay model. Runtime data remains API-backed; any synthetic browser fixture is test-only and must be identified in screenshots/reports.
