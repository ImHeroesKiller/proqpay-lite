# GT5 — Production Stability & Operational Hardening

Baseline: G4 merged as PR #316 at `348ac1a7a2de56110ef340c2c5619647d6508c96` (2026-10-13).

## Scope and safety
This phase is non-destructive by default. Automated checks MUST NOT approve payment instructions, execute disbursements, alter funding balances/limits, write financial records, perform live payment retries, bypass MFA, or use production credentials in CI. Authenticated production workflows require an explicitly authorized UAT identity and read-only operations. Never log tokens, bank accounts, personal data, OTPs or recovery codes.

## Gates
### GT5.1 Production health & deployment integrity
- Confirm production release commit matches intended main SHA.
- Verify login shell and backend health with GET/HEAD only.
- Verify sessionless privileged endpoints return 401/403, D1 health and required security headers.
- Preserve G4 a11y/visual/keyboard regression gate.

### GT5.2 Runtime reliability
- Verify refresh, expired token, MFA session continuity and intentional logout for each supported role.
- Ensure API failures map to actionable, accessible UI errors (no silent success).
- Confirm idempotent read-only retries and tenant-scoped state isolation.

### GT5.3 Transaction integrity (read-only)
- Walk canonical payroll -> immutable payment instruction -> controller approval state -> gateway status -> reconciliation views without state mutation.
- Validate controller is sole final payment approver; processor may prepare but not approve.
- Validate subclient credential fail-closed, canonical routing, no re-execution of archived UAT/legacy-paid PI.
- Reconcile UI totals and statuses against approved backend snapshot; never infer an actual payment from presentation status.

### GT5.4 Monitoring and audit
- Trace read-only requests with request/correlation IDs across edge, APIs and UI errors.
- Verify error rate, gateway failure and auth failure signals; separate alerting from customer-facing PII.
- Ensure audit trails contain actor, tenant, event and timestamp without secrets.

### GT5.5 Release closure
- Run TypeScript/lint/build/unit regression and G4 WCAG/viewport suites.
- Run permission matrix for Superadmin, Payroll Controller, Payroll Processor and client tenant roles.
- Produce a test-evidence matrix: test, environment, SHA, actor/role, expected, actual, result, evidence.
- Require no critical unresolved findings; merge only after passing CI and deployment smoke.
- Document out-of-scope tests (particularly live payment execution and unauthorized MFA sessions) as NOT RUN, never PASS.

## Acceptance
GT5 is CLOSED only when GT5.1–5.5 have linked evidence, the release SHA is deployed, automated gates pass, and all critical issues are resolved. This document defines the execution contract; it does not itself certify tests or production readiness.
