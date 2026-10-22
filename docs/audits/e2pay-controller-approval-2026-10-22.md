# Controller PI and Disbursement approval audit — 22 October 2026

Scope: approval UI, role/permission gates, maker-checker, MFA step-up, provider routing and identity, immutable PI integrity, liquidity freshness, approved limit, persistence, status refresh, and separation from financial execution. Production observations were SELECT-only; no live approval or transfer was performed.

## Confirmed failures and corrections

1. PI approval unconditionally called `SYNC_BALANCE` on `/api/e2pay-subaccounts`. That endpoint explicitly selects `account_scope='SUB_ACCOUNT'`; the deployed PI references an ACTIVE Master registry, so the sync returns 404 before `APPROVE_PAYMENT` is sent. Approval now reads the authoritative Master balance through `/api/e2pay-operations?resource=account&refresh=1`. A legacy sub-account is synced additionally only when the server explicitly reports that scope.
2. `liquidityError` was written but never rendered in the PI modal. It is now shown as an alert using the shared notice style. Manual sync catches the already-displayed error instead of producing an unhandled rejection.
3. DR approval did not refresh Master liquidity. The funding gate correctly refuses snapshots older than five minutes, even when a limit is already approved. E2Pay DR approval now refreshes Master balance before the approval request. MFA retry remains limited to the existing explicit 428 challenge; no generic financial retry was added.
4. The existing Controller browser fixture used `provider: MOCK`, skipping the actual E2Pay preapproval branch. It now uses an E2Pay Master fixture with stale/fresh funding, asserts that sub-account APIs are never used for Master approval, and verifies sync failure, server refusal, persistence-driven status updates, and DR MFA step-up.
5. PI routing labels incorrectly suggested a missing sub-account for Master payments. Detail now exposes only the registry account scope and renders Master labels accordingly.

## Read-only production evidence

- Application deployment is production; the configured provider environment is **UAT**.
- PI `PI/202601/B6FA84354F`: `PAYMENT_APPROVAL_PENDING`, amount Rp975,430,387, E2PAY/UAT, ACTIVE Master registry; zero approval records.
- Associated DR: `PENDING_APPROVAL`, same amount and provider environment.
- Master snapshot: Rp1,001,997,000, refreshed `2026-10-21T15:51:11.267Z`. This historical value cannot establish current liquidity; a live account read is required.
- Client-wide approved limit: ACTIVE Rp1,000,000,000; earlier project/client limits were REVOKED. No committed legacy or canonical limit usage was found.
- No custom `payment_security_limits` row; default single-payment limit Rp10 billion exceeds this PI. No active fraud blocks found. Both operational users are ACTIVE.
- Zero legacy gateway transactions and zero canonical disbursement executions observed. No writes were issued by this audit against production D1.

## Controls retained

Server approval continues to require the Controller role/capability, separate maker/checker, recent MFA in ENFORCE mode, transaction risk limits, valid routing/identity/contract, fresh sufficient balance, and scoped approved allocation. PI additionally validates recipient count, control total, account encryption, each line hash and immutable content hash, including the existing audited deferred-routing compatibility. These gates were not bypassed or relaxed.

DR approval and payment execution remain separate actions. No execution API is called by the new balance refresh or approval code. The backend DR integration regression verifies stale rejection, Controller-only account refresh, persisted APPROVED state, idempotent replay, one approval audit record, and zero financial provider posts/executions using synthetic data.

## Verification boundary

Unit/integration checks and the four-role browser gate use synthetic data. The browser gate blocks outside origins and rejects unexpected mutations. They do not prove a current production Controller session can complete MFA or that current provider liquidity remains sufficient. Live user approval remains intentionally unexecuted. Deployment and post-deploy health results are recorded by the CI workflows for the release commit.
