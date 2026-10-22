# E2Pay inquiry and interrupted execution audit — 22 October 2026

Scope: inquiry contract, bounded preflight, progress persistence, safe diagnostics, interrupted-ledger closure and UI continuation. No live inquiry, transfer, approval, database repair, migration or provider configuration change was performed by this implementation.

## Contract evidence

Reviewed `Dokumen SSD B2B API Disbursement_Version 1.1(2).pdf`, pages 29–32 and 36–37. Inquiry uses GET `/b2b/merchant/me/sdp/inquiry`, bearer access token, query parameters `accountId`, `bankId`, `amount`, and `Signature = Base64(HMAC-SHA256(client_secret, accountId:bankId:amount))`. The exact documented signature example is verified in an executable test. Response validation requires inquiry ID, matching account, amount and bank ID. Transfer remains the separate POST `/b2b/merchant/me/sdp/transaction` with the original stable client reference and immutable source snapshot. Response code 99 means Failed; it does not establish the reason for an inquiry rejection. Existing UAT destination substitution is unchanged.

## Code findings

The previous implementation ran all inquiries sequentially within a single invocation; its beneficiary limit applied only to the later financial POST phase. The outer error handler returned an error without closing the DR and execution ledger. Generic network error wrapping discarded runtime-limit diagnostics. These are independently reproducible code defects. Historical provider rejection reasons cannot be reconstructed without response diagnostics; response code 99 alone is insufficient.

Cloudflare current limit reference: https://developers.cloudflare.com/workers/platform/limits/#subrequests (retrieved 22 October 2026). The bounded implementation reduces per-invocation provider traffic without relying on a particular account plan.

## Changes

- Inquiry is bounded to at most five beneficiaries per invocation with a 20-second soft batch deadline. Each completed inquiry is persisted; remaining CREATED rows are resumed in the next invocation. Transfer is blocked until every beneficiary passes preflight.
- The first inquiry rejection or runtime failure stops further provider probes. Existing failures are not automatically retried. Returned bank ID is checked against the provider directory selection.
- The UI advances only after a successful persisted response with hasMore, shows progress and stops on any failed request or repeated progress marker. It permits explicit continuation of PROCESSING requests and includes EXECUTING/PROCESSING/FAILED in the Controller action queue. Leaving the component stops subsequent continuation calls.
- Error handling closes both DR and execution ledger while the caller owns the lease. Zero financial attempts becomes FAILED and releases the reservation. Any financial attempt becomes RECONCILIATION_REQUIRED and retains the reservation. No item attempt counter or provider reference is reset.
- Controller-only RECOVER_INTERRUPTED closes stale ledgers without any provider API call. It checks MFA in enforcement mode, an expired lease plus a two-minute grace period and at least four minutes without progress. Atomic lease acquisition repeats staleness checks to avoid racing another worker. Active or terminal executions are rejected.
- Audit JSON contains a numeric provider code when present, a classified rejection category, body byte length and SHA-256 fingerprint. Raw response bodies, account numbers, tokens and free-form runtime errors are not stored by the added diagnostics. Runtime limits, timeout and network failures have distinct error codes. Inquiry item errors use the safe category instead of free-form provider text.

## Validation

- 1,065 unit/backend tests passed, including exact documented signature/wire contract, 214-recipient chunk/resume/no-replay, first-error fail-fast, redaction, no-financial vs financial interruption, Controller/MFA gating and stale recovery with zero provider calls.
- TypeScript and production build passed. ESLint passed with existing warnings.
- Four-role browser synthetic tests passed with zero outside-provider traffic and zero runtime errors. The Controller scenario covers successful persisted-batch continuation, stopping on an inquiry rejection, refreshing the resulting FAILED state and stale-status recovery.

## Operational limitations

This change does not infer why E2Pay rejected the historical inquiries and does not reset or retry the historical payment. A fresh controlled inquiry is required to collect new diagnostics after release. Interrupted status closure is an explicit Controller action, not a GET-side mutation. FAILED executions continue to require controlled review/recovery; the patch deliberately does not turn failure into approval or automatically resend money. No schema change or new infrastructure is required.
