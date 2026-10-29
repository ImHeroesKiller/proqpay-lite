# ProQPay v2.1 baseline — 29 October 2026

Source: ImHeroesKiller/proqpay-lite, main 062b603132bd9d647c16a763b66e9443ac1f7d4a. Next 16 / React 19 static export, Pages Functions, existing D1/R2/Workers AI. Work branch: feat/workspace-v21-refinement. Production stays unchanged until separate approval.

Baseline verification: 1104/1104 node tests pass; typecheck and production build/CSS/CSP checks pass; ESLint 0 errors / 62 pre-existing warnings. Actual production route was inspected: session sign-in is required; no credentials requested or bypassed. Six latest user-supplied UAT screenshots were read alongside v2 mockups. Production screenshots contain client/financial data and are not committed to the public repository. Published comparison evidence uses local synthetic API fixtures only; runtime app data remains API-backed.

## Findings

- Numbered stepper and payroll status filters occupy large card/button surfaces. Workspace controls still use 42px heights and generous spacing.
- Reconcile & Close mounts PI reconciliation, canonical register, legacy archive and the complete five-section Billing workspace together, creating a very long page.
- Funding repeats the global client filter, exposes request amounts in the main allocation table and retains two settings sub-tabs inside a disclosure.
- Financial columns lack consistent right alignment; generic tables lack uniform sorting/pagination. Canonical register details append below the main table.
- Register/API failures can also render a no-data message. Some shared selections are silently cleared when option lists change.
- Legacy CSS remains a hashed compatibility cascade. Refine the scoped workspace feature stylesheet and shared semantic components; preserve legacy foundation hashes and final accessibility module order.

## Function preservation matrix

| Existing function | Current component | v2.1 location/component | API dependency | Permission | Regression coverage |
| --- | --- | --- | --- | --- | --- |
| Payroll prepare/review/approve/correct/adjust/detail | OperatingWorkspace/Submissions | Data & Payroll, existing actions + shared table | operating-model, pay-run-detail | existing derivePayrollNextAction/authority matrix | payroll-next-action, PI workflow, workspace browser UAT |
| PI submit/approve/reject/history/evidence | OperatingWorkspace/Payments | Payment Instructions, existing drawer | operating-model PI detail/actions, gateway | Controller permission + maker-checker/MFA unchanged | PI correctness, four-role Master closure browser tests |
| Canonical DR create/submit/approve/execute/recover/reconcile | CanonicalDisbursementWorkspace | Disbursement, existing actions + shared table | disbursement-requests/executions, canonical-transaction-register | existing request/approve/execution checks | canonical workspace, E2Pay multi-role closure tests |
| Master refresh/activate/diagnostics | E2PayFundingLimitControl | Funding summary + diagnostics disclosure | e2pay-operations | existing Admin activation / refresh policy | Master setup browser role matrix |
| Internal limit request/approve/reject/revoke/history | E2PayFundingLimitControl | Allocation table + request form/detail drawer | e2pay-disbursement-limits | Processor request / Controller decisions | funding API and role tests |
| Automatic three-route payment setup | ProviderChannelControl | One expandable payment routes panel | provider-channel-mappings, Master readiness | existing policy | routing and Master closure tests |
| Provider register, result/evidence/reconciliation | CanonicalTransactionRegister | Reconciliation tab, register + drawer | canonical-transaction-register, provider support JSON | Controller reconciliation permission, server checks unchanged | register pagination, support JSON, new tab/browser tests |
| PI proofs and legacy reconciliation actions | OperatingWorkspace/Payments + LegacyTransactionHistory | Reconciliation secondary disclosure / read-only archive | operating-model/proofs/reconciliations, legacy read endpoints | existing record-proof and reconciliation checks | reconciliation, immutable PI tests |
| Settlement readiness / close confirmation / closed history | BillingWorkspace/CloseSection | Settlement & Close tab | billing, CLOSE_PAY_RUN operating action | billing:approve + existing backend readiness | billing close tests + new close-tab tests |
| Invoice issue/revision/email/download/tax | BillingWorkspace/InvoiceSection/TaxSection | Billing & AR tab; tax in secondary tools | billing, invoice-email, invoice PDF routes | billing:prepare / billing:approve existing | billing, invoice delivery and modal regressions |
| AR receipts/reconciliation/follow-ups/history | BillingWorkspace/ARSection | Billing & AR tab, outstanding AR section | billing AR actions | ar:write existing | billing AR integrity and role tests |
| Billing issuer/client setup | BillingWorkspace/SetupSection | Billing & AR secondary tools | billing setup/issuer | existing Admin/Processor scope | billing setup, issuer and role tests |

All financial writes remain inside their existing explicit event handlers and backend contracts. No schema, credentials, fake provider statuses, real-money testing or data resets are part of this change. Completion indicators must be conservative and derive only from backend process state.
