# P5.8.2 — Legacy Credential Recovery & Canonical PI Readiness UAT

Status: READ-ONLY UAT IMPLEMENTED; actual E2Pay credential recovery **not executed** and PI conversion/payment **not executed**.

## Purpose

Move existing (non-executed) Payroll Payment Instruction to canonical workflow **only after** provider account recovery and immutable source verification, preserving all existing source rows. Never recreate provisioned subaccounts or replay gateway transactions.

## Current baseline (2026-10-12, verified P5.8 inventory)

- Two Payment Instructions, aggregate expected amount IDR 347,136,095.
- Exactly one PI is preliminary source-eligible (IDR 15,900,000), with no existing gateway transaction or canonical DR in active D1.
- Two E2Pay subaccounts exist; one has `LEGACY_MANUAL` credential and no `HEALTHY` credential at inventory time.
- The selected account / candidate PI relation **must be verified by P5.8.2 live SQL UAT**, not presumed from aggregate counts.
- No real provider payout or historical transaction status is inferred solely from missing active D1 rows; check backups and E2Pay history separately.

## Operational instructions — authorized session only

1. Super Admin or Payroll Processor signs in with existing passkey/MFA to `Clients` (or project override as applicable), selects the account with **Legacy Credential Recovery** state. Never create a replacement subaccount.
2. **In the ProQPay application itself**, enter the exact existing E2Pay merchant username/password issued for that subaccount. Never paste passwords, credentials, OTPs, provider tokens, or raw account numbers into ChatGPT, GitHub logs or attachments.
3. `BIND_SUBACCOUNT_CREDENTIAL` performs merchant authentication and **exact account ID matching**, encrypts/scopes credential, promotes provisioning to `HEALTHY`, and refreshes the subclient balance only after success. Errors remain fail-closed. Do not fake responses or skip this step.
4. In Payment Workbench → Canonical Disbursement, expand **P5.8.2 Legacy PI Readiness Check**. Inspect the PI's immutable recipient total, account routing, recovered credential, existing gateway/DR count and channel evidence. For each intended destination choose `Payroll → Employee` or `Payroll → Corporate` (the latter needs a governed primary corporate beneficiary).
5. Processor may **explicitly create** a new Canonical DR only if the read-only precheck says `canCreateCanonicalDr=true` and separately confirms the action. The existing `/api/disbursement-requests` endpoint remains the final authority and rechecks all invariants; precheck is never authority to execute.
6. Prior to `SUBMIT_REQUEST`, Super Admin must confirm provider channel mappings from genuine E2Pay evidence. Before Controller approval/execution, synchronize parent/subclient balances and obtain approved disbursement limit with current MFA. The Controller must complete their own approval, without maker self-approval.
7. Review provider transaction history and reconcile by stable `clientRef`; do not replay in-flight, failed/unknown, or settled legacy transactions as a new DR. If any source already has a gateway transaction, route to legacy reconciliation and stop canonical creation.

## CI/UAT coverage

- New `GET /api/legacy-pi-readiness` is scoped to privileged roles, bounded, nonmutating, accepts target PI/client and three read-only phases: source, credential/channel and liquidity readiness. Does not access provider APIs or create/submit/approve/execute/reconcile payments.
- 10 aggregate-only remote D1 SQL indicators in manually dispatched `P5.8.2 Legacy PI Readiness Read-Only` workflow; no IDs, names, bank numbers, secret metadata or account credentials in the saved artifact.
- Regression covers legacy credential blocker, post-recovery simulated lifecycle, gateway no-replay block, immutable snapshot mismatches, tenant/role scoping, UI redirection and denial of POST.
- A live authenticated UI test with passkey/MFA and real provider credentials remains a **manual operational gate**. A green read-only SQL workflow alone is not financial production sign-off.

## Explicit cutover restrictions

Automatic credential recovery: **DISABLED**. Automatic PI-to-DR creation: **DISABLED**. Provider disbursement execution: **DISABLED** from this P5.8.2 precheck. Production final cutover: **BLOCKED** until identity, channel, liquidity, immutable snapshot and operational approval evidence are reviewed.
